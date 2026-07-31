'use strict';

/**
 * survival-testbed — mongo seeder.
 *
 *   node seed/index.js            # upsert everything (idempotent)
 *   node seed/index.js --reset    # delete previously seeded docs first
 *   node seed/index.js --verify   # only run the survival read-back check
 *
 * Env:
 *   MONGO_URL       default mongodb://127.0.0.1:27077
 *   QUESTIONS_DB    default questions_db     (questions-api)
 *   MAIN_DB         default quizdb           (main-server / fight-server)
 *   SEED_LANGUAGES  default en,uk
 *   SEED_SKIP_MAIN_DB=1 to leave MAIN_DB untouched
 *
 * Only documents carrying `seedBatch: 'survival-testbed'` are ever written or
 * deleted, so this never clobbers anything else living in the database.
 */

const { MongoClient, ObjectId } = require('mongodb');
const {
  SEED_MARKER,
  TRACK,
  TYPE,
  STATUS_READY,
  ROOT_CATEGORIES,
  QUESTION_ID_COUNTER_START,
  CATEGORY_ID_COUNTER_START,
  buildCategories,
  buildQuestions,
} = require('./content');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27077';
const QUESTIONS_DB = process.env.QUESTIONS_DB || 'questions_db';
const MAIN_DB = process.env.MAIN_DB || 'quizdb';
const LANGUAGES = (process.env.SEED_LANGUAGES || 'en,uk')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const argv = process.argv.slice(2);
const RESET = argv.includes('--reset');
const VERIFY_ONLY = argv.includes('--verify') || argv.includes('--verify-only');

const num = (name, dflt) => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : dflt;
};

// Sized so a normal fight has content at every difficulty band
// (getDifficultiesByCups() narrows to a single difficulty below 800 cups) and
// across enough second-level categories to satisfy amountPerSubcategory limits.
const COUNTS = {
  generalChoicePerCategory: num('SEED_GENERAL_CHOICE', 60), // 6 subcategories x 5 difficulties x 2
  generalNumericalPerCategory: num('SEED_GENERAL_NUMERICAL', 25),
  generalMap: num('SEED_GENERAL_MAP', 20), // geography only
  survivalChoicePerCategory: num('SEED_SURVIVAL_CHOICE', 10), // -> 50 total
  survivalNumericalPerCategory: num('SEED_SURVIVAL_NUMERICAL', 2), // -> 10 total
  survivalMap: num('SEED_SURVIVAL_MAP', 12),
};

// Stable fake author so editorProjection's `authorId.toHexString()` never blows up.
const AUTHOR_ID = new ObjectId('000000000000000000005eed');

// ─── small helpers ───────────────────────────────────────────────────────────

const line = (s = '') => process.stdout.write(`${s}\n`);

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

async function upsertAll(collection, docs, batchSize = 500) {
  let written = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const slice = docs.slice(i, i + batchSize);
    const ops = slice.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    const res = await collection.bulkWrite(ops, { ordered: false });
    written += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0);
  }
  return written;
}

async function bestEffort(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    line(`  ! ${label}: ${err.message}`);
    return false;
  }
}

// ─── verification: mirrors questions-api exactly ─────────────────────────────

/**
 * The same mongo query `findByRequest` builds for the params passed by
 * get-questions-for-survival.ts:
 *   { tracks: [survival], statuses: [ready], isValid: InclusionOption.Include }
 * -> criterias are $and-ed, isValid: 1 === Include -> { isValid: true }.
 */
const SURVIVAL_FILTER = {
  $and: [
    { track: { $in: [TRACK.SURVIVAL] } },
    { status: { $in: [STATUS_READY] } },
    { isValid: true },
  ],
};

// questions-db.ts editorProjection (the projection findByRequest actually uses)
const EDITOR_PROJECTION = {
  isValid: 1, categoryId: 1, authorId: 1, updatorId: 1, imageId: 1, audioId: 1,
  type: 1, track: 1, tags: 1, locales: 1, shuffledAnswers: 1, source: 1, status: 1,
  difficulty: 1, needUpdate: 1, requiredLanguages: 1, createdAt: 1, updatedAt: 1,
  rating: 1, winRate: 1, counter: 1, reports: 1,
};

const TYPE_INT = { choice: 0, numerical: 1, map: 2 }; // QuestionTypeInt

/** documentToQuestion + questionToGame, condensed. */
function toSurvivalPayload(doc) {
  const locales = (doc.locales || []).map(({ language, question, correct, wrong }) => ({
    language,
    question,
    answers: [correct, ...(wrong || [])],
  }));
  if (doc.type === TYPE.CHOICE) {
    return {
      id: doc._id,
      type: TYPE_INT.choice,
      localizations: locales.map((l) => ({
        language: l.language,
        question: l.question,
        answers: doc.shuffledAnswers.map((i) => l.answers[i]),
      })),
      correct: doc.shuffledAnswers.indexOf(0),
    };
  }
  return {
    id: doc._id,
    type: TYPE_INT[doc.type],
    localizations: locales.map((l) => ({ language: l.language, question: l.question })),
    correct: locales[0].answers[0],
  };
}

async function verifySurvival(questionsCol) {
  line();
  line('── VERIFY: survival read-back (same filter as get-questions-for-survival.ts) ──');
  line(`   filter: ${JSON.stringify(SURVIVAL_FILTER)}`);

  const docs = await questionsCol
    .find(SURVIVAL_FILTER, { projection: EDITOR_PROJECTION })
    .limit(500) // SURVIVAL_FETCH_LIMIT
    .toArray();

  const payload = docs.map(toSurvivalPayload);
  const byType = { 0: 0, 1: 0, 2: 0 };
  const correctPositions = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let missingLang = 0;

  for (const q of payload) {
    byType[q.type] += 1;
    if (q.type === TYPE_INT.choice) correctPositions[q.correct] += 1;
    for (const lang of LANGUAGES) {
      if (!q.localizations.some((l) => l.language === lang)) missingLang += 1;
    }
  }

  line(`   returned: ${payload.length} questions`);
  line(`   by type:  CHOICE=${byType[0]}  NUMERICAL=${byType[1]}  MAP=${byType[2]}`);
  line(`   localizations missing a required language: ${missingLang}`);
  line(
    '   correct-option position histogram (choice): ' +
      Object.entries(correctPositions).map(([k, v]) => `${k}:${v}`).join('  '),
  );
  if (correctPositions[0] === byType[0] && byType[0] > 0) {
    line('   !! every correct answer sits at index 0 — the "always option 0" bug would be invisible');
  } else {
    line('   ok: correct answers are spread across all four positions,');
    line('       so survivalQuestionProvider hardcoding `correct: 0` is observable in-game.');
  }

  const sample = payload.find((q) => q.type === TYPE_INT.choice);
  if (sample) {
    const en = sample.localizations.find((l) => l.language === 'en') || sample.localizations[0];
    line();
    line(`   sample choice question #${sample.id}`);
    line(`     ${en.question}`);
    en.answers.forEach((a, i) => line(`       [${i}] ${a}${i === sample.correct ? '   <-- correct' : ''}`));
  }
  const mapSample = payload.find((q) => q.type === TYPE_INT.map);
  if (mapSample) {
    const en = mapSample.localizations.find((l) => l.language === 'en') || mapSample.localizations[0];
    line(`   sample map question   #${mapSample.id}: ${en.question} -> [${mapSample.correct}]`);
  }
  const numSample = payload.find((q) => q.type === TYPE_INT.numerical);
  if (numSample) {
    const en = numSample.localizations.find((l) => l.language === 'en') || numSample.localizations[0];
    line(`   sample number question #${numSample.id}: ${en.question} -> ${numSample.correct}`);
  }

  return payload.length;
}

/** Mirrors questions-db.ts generateQuery() — the query a real fight runs. */
async function verifyFight(questionsCol, categoriesCol) {
  line();
  line('── VERIFY: fight read-back (same filter as questions-db.ts generateQuery) ──');
  const cats = await categoriesCol.find({}).toArray();
  const header = `   ${pad('category', 12)}${pad('type', 11)}${padLeft('d1', 5)}${padLeft('d1-3', 7)}${padLeft('d1-5', 7)}${padLeft('d3-5', 7)}`;
  line(header);
  for (const root of ROOT_CATEGORIES) {
    const ids = cats.filter((c) => c._id === root.id || (c.ancestors || []).includes(root.id)).map((c) => c._id);
    for (const type of [TYPE.CHOICE, TYPE.NUMERICAL, TYPE.MAP]) {
      if (type === TYPE.MAP && root.name !== 'geography') continue;
      const counts = [];
      for (const [min, max] of [[1, 1], [1, 3], [1, 5], [3, 5]]) {
        counts.push(
          await questionsCol.countDocuments({
            _id: { $nin: [] },
            isValid: true,
            status: STATUS_READY,
            track: TRACK.GENERAL,
            type,
            difficulty: { $gte: min, $lte: max },
            categoryId: { $in: ids },
            requiredLanguages: { $all: [LANGUAGES[0]] },
            imageId: null,
            audioId: null,
          }),
        );
      }
      line(
        `   ${pad(root.name, 12)}${pad(type, 11)}` +
          counts.map((c, i) => padLeft(c, i === 0 ? 5 : 7)).join(''),
      );
    }
  }
  line('   (columns = difficulty window picked by getDifficultiesByCups(); <800 cups -> d1 only)');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  line('survival-testbed seed');
  line(`  mongo        ${MONGO_URL}`);
  line(`  questions db ${QUESTIONS_DB}`);
  line(`  main db      ${MAIN_DB}`);
  line(`  languages    ${LANGUAGES.join(', ')}`);
  line();

  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  await client.connect();

  const qdb = client.db(QUESTIONS_DB);
  const questionsCol = qdb.collection('questions');
  const categoriesCol = qdb.collection('categories');
  const countersCol = qdb.collection('counters');

  try {
    if (VERIFY_ONLY) {
      await verifySurvival(questionsCol);
      await verifyFight(questionsCol, categoriesCol);
      return;
    }

    const categories = buildCategories();
    const questions = buildQuestions({ languages: LANGUAGES, counts: COUNTS, authorId: AUTHOR_ID });

    // sanity: ids must be unique
    const ids = questions.map((q) => q._id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('internal error: duplicate question _id generated');
    }

    if (RESET) {
      const dq = await questionsCol.deleteMany({ seedBatch: SEED_MARKER });
      const dc = await categoriesCol.deleteMany({ seedBatch: SEED_MARKER });
      line(`reset: removed ${dq.deletedCount} questions, ${dc.deletedCount} categories`);
    }

    // ── categories ──────────────────────────────────────────────────────────
    await upsertAll(categoriesCol, categories);
    const staleCats = await categoriesCol.deleteMany({
      seedBatch: SEED_MARKER,
      _id: { $nin: categories.map((c) => c._id) },
    });

    // ── questions ───────────────────────────────────────────────────────────
    await upsertAll(questionsCol, questions);
    const staleQs = await questionsCol.deleteMany({
      seedBatch: SEED_MARKER,
      _id: { $nin: ids },
    });

    // ── counters (counters.ts throws if the doc is missing) ─────────────────
    await countersCol.updateOne(
      { _id: 'question_id' },
      { $max: { counter: QUESTION_ID_COUNTER_START } },
      { upsert: true },
    );
    await countersCol.updateOne(
      { _id: 'category_id' },
      { $max: { counter: CATEGORY_ID_COUNTER_START } },
      { upsert: true },
    );

    // ── indexes (best effort — the game queries work without them) ──────────
    await bestEffort('questions indexes', async () => {
      await questionsCol.createIndex({ track: 1, status: 1, isValid: 1 }, { name: 'seed_track_status_valid' });
      await questionsCol.createIndex(
        { track: 1, status: 1, isValid: 1, type: 1, categoryId: 1, difficulty: 1, rand: 1 },
        { name: 'seed_game_query' },
      );
      await categoriesCol.createIndex({ ancestors: 1 }, { name: 'seed_ancestors' });
      await categoriesCol.createIndex({ parentId: 1 }, { name: 'seed_parent' });
    });
    // The editor's free-text search ($text in findByRequest) needs a text index.
    // `language_override` must point at a field no document has: otherwise mongo
    // treats locales[].language ('uk') as a stemmer name and the build fails.
    await bestEffort('questions text index', async () => {
      await questionsCol.createIndex(
        { 'locales.question': 'text' },
        { name: 'seed_text_search', default_language: 'none', language_override: 'textLanguage' },
      );
    });

    // ── main db: no players (the gateway signs its own mock user up) ────────
    let mainDbNote = 'skipped';
    if (!process.env.SEED_SKIP_MAIN_DB) {
      const mdb = client.db(MAIN_DB);
      const existing = (await mdb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
      for (const name of ['players', 'playedQuestions']) {
        if (!existing.includes(name)) {
          await bestEffort(`create ${MAIN_DB}.${name}`, () => mdb.createCollection(name));
        }
      }
      await bestEffort(`${MAIN_DB}.players index`, () =>
        mdb.collection('players').createIndex({ playerId: 1 }, { name: 'seed_playerId' }),
      );
      mainDbNote = 'players + playedQuestions collections ensured (0 player docs created)';
    }

    // ── summary ─────────────────────────────────────────────────────────────
    printSummary(questions, categories, { staleQs: staleQs.deletedCount, staleCats: staleCats.deletedCount, mainDbNote });

    const survivalCount = await verifySurvival(questionsCol);
    await verifyFight(questionsCol, categoriesCol);

    line();
    if (survivalCount === 0) {
      line('FAILED: the survival filter returned 0 questions.');
      process.exitCode = 1;
    } else {
      line(`Done. ${survivalCount} survival questions are reachable through the real API filter.`);
    }
  } finally {
    await client.close();
  }
}

function printSummary(questions, categories, extra) {
  const roots = categories.filter((c) => c.parentId === null).length;
  line('── inserted / updated ────────────────────────────────────────────────');
  line(`  ${QUESTIONS_DB}.categories : ${categories.length}  (${roots} root + ${categories.length - roots} sub)`);
  line(`  ${QUESTIONS_DB}.questions  : ${questions.length}`);
  line(`  ${QUESTIONS_DB}.counters   : question_id >= ${QUESTION_ID_COUNTER_START}, category_id >= ${CATEGORY_ID_COUNTER_START}`);
  line(`  ${MAIN_DB}                 : ${extra.mainDbNote}`);
  if (extra.staleQs || extra.staleCats) {
    line(`  removed stale seed docs   : ${extra.staleQs} questions, ${extra.staleCats} categories`);
  }
  line();

  const cats = ROOT_CATEGORIES.map((c) => c.name);
  const types = [TYPE.CHOICE, TYPE.NUMERICAL, TYPE.MAP];
  // seeded categoryIds are second-level (rootId * 10 + n) — map them back to the root
  const nameOf = (categoryId) => {
    const rootId = categoryId < 10 ? categoryId : Math.floor(categoryId / 10);
    const root = ROOT_CATEGORIES.find((c) => c.id === rootId);
    return root ? root.name : '?';
  };

  for (const track of [TRACK.SURVIVAL, TRACK.GENERAL]) {
    line(`── track: ${track} ──`);
    line(`  ${pad('', 12)}${types.map((t) => padLeft(t, 12)).join('')}${padLeft('total', 8)}`);
    let grand = 0;
    for (const cat of cats) {
      const row = types.map(
        (t) => questions.filter((q) => q.track === track && q.type === t && nameOf(q.categoryId) === cat).length,
      );
      const total = row.reduce((a, b) => a + b, 0);
      grand += total;
      line(`  ${pad(cat, 12)}${row.map((n) => padLeft(n, 12)).join('')}${padLeft(total, 8)}`);
    }
    const totals = types.map((t) => questions.filter((q) => q.track === track && q.type === t).length);
    line(`  ${pad('TOTAL', 12)}${totals.map((n) => padLeft(n, 12)).join('')}${padLeft(grand, 8)}`);
    line();
  }

  const byDifficulty = {};
  for (const q of questions) {
    if (q.track !== TRACK.GENERAL) continue;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
  }
  line(
    `  general questions by difficulty: ${Object.keys(byDifficulty)
      .sort()
      .map((d) => `d${d}=${byDifficulty[d]}`)
      .join('  ')}`,
  );
}

main().catch((err) => {
  line();
  line(`SEED FAILED: ${err.message}`);
  if (err.name === 'MongoServerSelectionError') {
    line(`Could not reach mongo at ${MONGO_URL}.`);
    line('Start the testbed stack first (docker compose up -d mongo) or set MONGO_URL.');
  }
  process.exit(1);
});
