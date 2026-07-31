'use strict';

// Copies REAL content from production into the local testbed mongo.
//
//   node seed/import-prod-content.js
//
// Strictly read-only against production: it only ever calls find()/aggregate() there.
// Two sources, because they are genuinely different databases:
//
//   chrono_db  (mongo 7, chrono editor)  -> ready `levels` + their `facts` + `categories`
//   questions_db (mongo 3.4, prod quiz)  -> real `numerical` questions, tagged survival
//
// The prod quiz DB speaks an old wire protocol that the modern driver refuses, so those
// questions are pulled with `mongoexport` (mongodb-database-tools) instead.

const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const LOCAL_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27077';
const QUESTIONS_DB = process.env.QUESTIONS_DB || 'questions_db';
const CHRONO_DB = process.env.CHRONO_DB || 'chrono_db';
const SEED_BATCH = 'survival-testbed';

const CHRONO_URI = process.env.CHRONO_SOURCE_URI;
const QUESTIONS_URI = process.env.QUESTIONS_SOURCE_URI;

const NUMERICAL_LIMIT = parseInt(process.env.NUMERICAL_LIMIT || '120', 10);

if (!CHRONO_URI) {
  console.error('CHRONO_SOURCE_URI is required (production chrono db, read-only)');
  process.exit(1);
}

// ─── chrono ───────────────────────────────────────────────────────────────────

async function importChrono(local) {
  const src = await MongoClient.connect(CHRONO_URI, {
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    const sdb = src.db(CHRONO_DB);

    // Only `ready` levels: drafts are unfinished editor work.
    const levels = await sdb.collection('levels').find({ status: 'ready' }).toArray();
    const factIds = [...new Set(levels.flatMap((l) => (l.factIds || []).map(String)))];
    const facts = await sdb
      .collection('facts')
      .find({ _id: { $in: factIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const categories = await sdb.collection('categories').find({}).toArray();

    const ldb = local.db(CHRONO_DB);
    for (const [name, docs] of [
      ['levels', levels],
      ['facts', facts],
      ['categories', categories],
    ]) {
      const col = ldb.collection(name);
      await col.deleteMany({ seedBatch: SEED_BATCH });
      if (docs.length) {
        await col.insertMany(docs.map((d) => ({ ...d, seedBatch: SEED_BATCH })), { ordered: false });
      }
      console.log(`  chrono_db.${name}: ${docs.length}`);
    }

    const withUk = facts.filter((f) => (f.locales || []).some((l) => l.language === 'ua')).length;
    console.log(`  фактів з українською локаллю: ${withUk} з ${facts.length}`);
    return { levels: levels.length, facts: facts.length };
  } finally {
    await src.close();
  }
}

// ─── numerical questions (old mongo → mongoexport) ────────────────────────────

async function fetchNumericalFromProd() {
  if (!QUESTIONS_URI) {
    console.log('  QUESTIONS_SOURCE_URI не заданий — пропускаю numerical');
    return [];
  }

  // The prod quiz db is mongo 3.4; the modern driver (and mongoexport 100.x) refuse
  // its wire version, so this one read goes through a pinned legacy driver.
  const legacy = require(path.join(__dirname, 'legacy-driver', 'node_modules', 'mongodb'));
  let client;
  try {
    client = await legacy.MongoClient.connect(QUESTIONS_URI, {
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 15000,
    });
    return await client
      .db(QUESTIONS_DB)
      .collection('questions')
      .find({ type: 'numerical', status: 'ready', isValid: true })
      .limit(NUMERICAL_LIMIT)
      .toArray();
  } catch (err) {
    // never let a driver error carry the connection string into a log
    throw new Error(`не вдалося прочитати прод questions_db: ${String(err.message).split('mongodb://')[0]}`);
  } finally {
    if (client) await client.close();
  }
}

/**
 * Documents read through the legacy driver carry its own ObjectID class, which the
 * modern driver refuses to insert. Flatten every id to a plain hex string — nothing
 * downstream needs them to stay BSON ids.
 */
function normalizeBson(value) {
  if (Array.isArray(value)) return value.map(normalizeBson);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') return String(value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeBson(v)]));
  }
  return value;
}

/** mongoexport emits extended JSON ($oid/$numberInt/…); flatten it back to plain values */
function fromExtendedJson(value) {
  if (Array.isArray(value)) return value.map(fromExtendedJson);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const [k] = keys;
      if (k === '$oid') return value[k];
      if (k === '$numberInt' || k === '$numberLong') return Number(value[k]);
      if (k === '$numberDouble') return Number(value[k]);
      if (k === '$date') return new Date(value[k]);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromExtendedJson(v)]));
  }
  return value;
}

async function importNumerical(local) {
  const raw = await fetchNumericalFromProd();
  if (!raw.length) return 0;

  const questions = local.db(QUESTIONS_DB).collection('questions');
  const existing = await questions.find({}, { projection: { _id: 1 } }).toArray();
  const maxId = existing.reduce((m, d) => Math.max(m, Number(d._id) || 0), 0);

  // Local ids are numeric; prod ids are ObjectIds, so renumber above whatever is seeded.
  let nextId = Math.max(maxId + 1, 400000);
  const docs = raw.map((doc) => {
    const clean = normalizeBson(fromExtendedJson(doc));
    delete clean._id;
    return {
      ...clean,
      _id: nextId++,
      track: 'survival',
      status: 'ready',
      isValid: true,
      seedBatch: SEED_BATCH,
      fromProd: true,
    };
  });

  await questions.deleteMany({ seedBatch: SEED_BATCH, fromProd: true });
  await questions.insertMany(docs, { ordered: false });
  console.log(`  questions_db.questions: +${docs.length} numerical (track=survival)`);
  return docs.length;
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  const local = await MongoClient.connect(LOCAL_URL, { useUnifiedTopology: true });
  try {
    console.log('chrono (mongo 7, read-only):');
    const chrono = await importChrono(local);

    console.log('\nnumerical з бойової questions_db (mongo 3.4, read-only):');
    const numerical = await importNumerical(local);

    console.log(
      `\nГотово. Рівнів: ${chrono.levels}, фактів: ${chrono.facts}, числових питань: ${numerical}.`,
    );
  } finally {
    await local.close();
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
