'use strict';

/**
 * survival-testbed — builds ONE daily predefined Survival set directly into the
 * local testbed mongo (db `survival_factory`, collection `survival_sets`) from
 * the content already seeded there (questions_db + chrono_db).
 *
 *   node seed/make-survival-set.js                                # today, 30 rounds, LOCKED
 *   node seed/make-survival-set.js --state LOCKED --start-in-seconds 90
 *   node seed/make-survival-set.js --state LOCKED --start-in-seconds -300  # startAt 5 min AGO
 *   node seed/make-survival-set.js --date 2026-08-01 --rounds 8 --state DRAFT
 *   node seed/make-survival-set.js --seed e2e --formats CHOICE,NUMERIC,MAP
 *
 * Flags:
 *   --date YYYY-MM-DD        UTC day of the set               (default: today UTC)
 *   --rounds N               roundsTotal                      (default: 30)
 *   --start-in-seconds N     startAt = now + N seconds        (default: 60)
 *                            N may be NEGATIVE: startAt lands in the past, which is how
 *                            survival-server's missed-start recovery is exercised — a
 *                            LOCKED/LIVE set whose startAt has passed with no fight record
 *                            for the day makes the server log the miss and open onboarding
 *                            on its next scheduler tick instead of waiting for tomorrow.
 *   --state DRAFT|LOCKED     final state of the set           (default: LOCKED)
 *   --seed STR               deterministic generation seed    (default: random)
 *   --formats A,B,C          enabled formats                  (default: CHOICE,NUMERIC,MAP,CHRONO)
 *   --track survival|any     questions_db track filter        (default: survival)
 *   --no-anchor              do NOT force the last round to MAP
 *
 * The document implements the shared-contract slot + payloadSnapshot shapes
 * exactly (see the spec: survival_sets doc + snapshot shapes). Re-running for
 * the same date replaces the existing set. This is a testbed helper, not the
 * production builder: candidate exclusion is in-set dedup only (no freshness
 * window across other sets).
 *
 * Env: MONGO_URL (default mongodb://127.0.0.1:27077) — local testbed mongo only.
 */

const { MongoClient } = require('mongodb');

// ─── args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

const todayUtc = () => new Date().toISOString().slice(0, 10);

const DATE = arg('date', todayUtc());
const ROUNDS = parseInt(arg('rounds', '30'), 10);
const START_IN_SECONDS = parseInt(arg('start-in-seconds', '60'), 10);
const STATE = String(arg('state', 'LOCKED')).toUpperCase();
const SEED = String(arg('seed', Math.random().toString(16).slice(2, 10)));
const TRACK = String(arg('track', 'survival'));
const ANCHOR_LAST_MAP = !flag('no-anchor');

const ALL_FORMATS = ['CHOICE', 'NUMERIC', 'MAP', 'CHRONO'];
// deduped: a repeated format would make the cycle-boundary rejection loop in
// buildFormatSequence unable to ever terminate
const FORMATS = [
  ...new Set(
    String(arg('formats', ALL_FORMATS.join(',')))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  ),
];

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27077';
const QUESTIONS_DB = process.env.QUESTIONS_DB || 'questions_db';
const CHRONO_DB = process.env.CHRONO_DB || 'chrono_db';
const SETS_DB = process.env.SETS_DB || 'survival_factory';

const FORMAT_TO_TYPE = { CHOICE: 'choice', NUMERIC: 'numerical', MAP: 'map' };

// Same envelope as buildChronoQuestion in survival-server/src/chronoSource.ts
const CHRONO_MIN_EVENTS = 3;
const CHRONO_MAX_EVENTS = 8;

// ─── validation ───────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`make-survival-set: ${msg}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) fail(`--date must be YYYY-MM-DD, got '${DATE}'`);
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) fail(`--rounds must be a positive integer`);
if (!Number.isInteger(START_IN_SECONDS)) fail(`--start-in-seconds must be an integer`);
if (STATE !== 'DRAFT' && STATE !== 'LOCKED') fail(`--state must be DRAFT or LOCKED`);
if (TRACK !== 'survival' && TRACK !== 'any') fail(`--track must be survival or any`);
if (!FORMATS.length) fail('--formats is empty');
for (const f of FORMATS) {
  if (!ALL_FORMATS.includes(f)) fail(`unknown format '${f}' (allowed: ${ALL_FORMATS.join(',')})`);
}
// This script must never point anywhere but the local testbed mongo. The host
// part must END at the port/path boundary: no multi-host seed lists and no
// remote hosts that merely start with "127.0.0.1"/"localhost".
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^,]*)?$/.test(MONGO_URL)) {
  fail(`MONGO_URL '${MONGO_URL}' is not local — this script only writes to the testbed`);
}

// ─── deterministic RNG (mulberry32 seeded with FNV-1a of --seed) ─────────────

function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(fnv1a(SEED));

function shuffleCopy(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ─── format sequence (contract §generation 1) ────────────────────────────────
// Shuffled cycle of enabled formats; the last format of cycle N must not equal
// the first of cycle N+1; anchorLastMap forces the final round to MAP.

function buildFormatSequence(rounds, formats) {
  const seq = [];
  let prevCycleLast = null;
  while (seq.length < rounds) {
    let cycle = shuffleCopy(formats);
    if (formats.length > 1) {
      while (cycle[0] === prevCycleLast) cycle = shuffleCopy(formats);
    }
    prevCycleLast = cycle[cycle.length - 1];
    for (const f of cycle) {
      if (seq.length < rounds) seq.push(f);
    }
  }
  if (ANCHOR_LAST_MAP && formats.includes('MAP')) seq[rounds - 1] = 'MAP';
  return seq;
}

// ─── questions_db snapshots (contract §payloadSnapshot shapes) ───────────────

function choiceSnapshot(doc) {
  const anyLocale = (doc.locales || [])[0] || {};
  const answersCount = 1 + ((anyLocale.wrong || []).length || 0);
  const perm =
    Array.isArray(doc.shuffledAnswers) && doc.shuffledAnswers.length === answersCount
      ? doc.shuffledAnswers
      : Array.from({ length: answersCount }, (_, i) => i);
  return {
    id: doc._id,
    type: 'choice',
    localizations: (doc.locales || []).map((l) => {
      const base = [l.correct, ...(l.wrong || [])];
      return { language: l.language, question: l.question, answers: perm.map((i) => base[i]) };
    }),
    correct: perm.indexOf(0),
  };
}

function numericSnapshot(doc) {
  return {
    id: doc._id,
    type: 'numerical',
    localizations: (doc.locales || []).map((l) => ({ language: l.language, question: l.question })),
    correct: Number((doc.locales || [])[0].correct),
  };
}

function mapSnapshot(doc) {
  const correct = (doc.locales || [])[0].correct; // [lat, lng]
  return {
    id: doc._id,
    type: 'map',
    localizations: (doc.locales || []).map((l) => ({ language: l.language, question: l.question })),
    correct: [Number(correct[0]), Number(correct[1])],
  };
}

const SNAPSHOT_BUILDERS = { choice: choiceSnapshot, numerical: numericSnapshot, map: mapSnapshot };

// ─── chrono snapshot (mirrors survival-server/src/chronoSource.ts) ───────────

// chrono_db tags Ukrainian as `ua`; the game calls it `uk`
const LANGUAGE_ALIASES = { ua: 'uk' };
const normalizeLanguage = (raw) => {
  const code = String(raw || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[code] || code;
};

// Stable negative int32 id for a level, identical to chronoSource.levelQuestionId
function levelQuestionId(levelId) {
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < levelId.length; i++) {
    hash = Math.imul(hash ^ levelId.charCodeAt(i), 16777619);
  }
  return -1 - ((hash >>> 0) % 2147483000);
}

function factYear(fact) {
  if (fact.chrono && typeof fact.chrono.year === 'number') return fact.chrono.year;
  if (fact.chronoNormalized && typeof fact.chronoNormalized.year === 'number') {
    return fact.chronoNormalized.year;
  }
  if (typeof fact.sortStart === 'number' && Number.isFinite(fact.sortStart)) return fact.sortStart;
  return null;
}

// The level's own correctOrder, or the facts' own timeline when it no longer
// covers exactly the loaded facts; ambiguous timelines are rejected.
function orderChronologically(facts, rawOrder) {
  const byId = new Map(facts.map((f) => [String(f._id), f]));
  if (Array.isArray(rawOrder) && rawOrder.length === facts.length) {
    const ordered = [];
    const used = new Set();
    for (const raw of rawOrder) {
      const id = String(raw);
      const fact = byId.get(id);
      if (!fact || used.has(id)) break;
      used.add(id);
      ordered.push(fact);
    }
    if (ordered.length === facts.length) return ordered;
  }
  const starts = facts.map((f) => f.sortStart);
  if (!starts.every((s) => typeof s === 'number' && Number.isFinite(s))) return null;
  if (new Set(starts).size !== starts.length) return null;
  return [...facts].sort((a, b) => a.sortStart - b.sortStart);
}

/** Builds the CHRONO payloadSnapshot, or null when the level cannot be trusted */
function chronoSnapshot(level, factsById) {
  const facts = [];
  const seen = new Set();
  for (const rawId of level.factIds || []) {
    const id = String(rawId);
    if (seen.has(id)) continue;
    const fact = factsById.get(id);
    if (!fact || typeof fact.question !== 'string' || fact.question.trim() === '') continue;
    if (factYear(fact) === null) continue; // events need a numeric year
    seen.add(id);
    facts.push(fact);
  }
  if (facts.length < CHRONO_MIN_EVENTS || facts.length > CHRONO_MAX_EVENTS) return null;

  const chronological = orderChronologically(facts, level.correctOrder);
  if (!chronological) return null;

  // Display order must not leak the answer
  const display = shuffleCopy(facts);
  const positions = new Map(display.map((f, i) => [String(f._id), i]));
  const correctOrder = chronological.map((f) => positions.get(String(f._id)));

  // uk is offered only when EVERY event carries it — a partial set would mix
  // languages inside a single question (same rule as chronoSource.ts)
  const ukTexts = display.map((f) => {
    const locale = (f.locales || []).find((l) => l && normalizeLanguage(l.language) === 'uk');
    return locale && typeof locale.question === 'string' ? locale.question.trim() : '';
  });
  const includeUk = ukTexts.every((t) => t !== '');

  const events = display.map((f, i) => {
    const text = { en: f.question.trim() };
    if (includeUk) text.uk = ukTexts[i];
    return { id: i, text, year: factYear(f) };
  });

  const title = typeof level.title === 'string' ? level.title.trim() : '';
  return {
    id: levelQuestionId(String(level._id)),
    type: 'chrono',
    localizations: [{ language: 'en', title }],
    events,
    correctOrder,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

const line = (s = '') => process.stdout.write(`${s}\n`);

async function main() {
  line('make-survival-set');
  line(`  mongo   ${MONGO_URL}`);
  line(`  date    ${DATE} (UTC)  rounds ${ROUNDS}  state ${STATE}`);
  line(`  seed    ${SEED}  formats ${FORMATS.join(',')}  track ${TRACK}` +
       `  anchorLastMap ${ANCHOR_LAST_MAP}`);
  line();

  const client = await MongoClient.connect(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  try {
    const questionsCol = client.db(QUESTIONS_DB).collection('questions');
    const chronoDb = client.db(CHRONO_DB);
    const setsCol = client.db(SETS_DB).collection('survival_sets');

    // candidate id pools, sorted so the seeded RNG is reproducible
    const questionPool = {}; // type -> number[]
    for (const format of ['CHOICE', 'NUMERIC', 'MAP']) {
      if (!FORMATS.includes(format)) continue;
      const type = FORMAT_TO_TYPE[format];
      const filter = { type, status: 'ready', isValid: true };
      if (TRACK !== 'any') filter.track = TRACK;
      const ids = await questionsCol.find(filter).project({ _id: 1 }).sort({ _id: 1 }).toArray();
      questionPool[type] = ids.map((d) => d._id);
    }
    let levelPool = [];
    if (FORMATS.includes('CHRONO')) {
      const ids = await chronoDb
        .collection('levels')
        .find({ status: 'ready', 'factIds.0': { $exists: true } })
        .project({ _id: 1 })
        .sort({ _id: 1 })
        .toArray();
      levelPool = ids.map((d) => String(d._id));
    }

    const formatSeq = buildFormatSequence(ROUNDS, FORMATS);
    const usedQuestionIds = new Set(); // in-set dedup (questions_db id space)
    const usedLevelIds = new Set(); //   in-set dedup (chrono level id space)
    const slots = [];

    for (let roundNo = 1; roundNo <= ROUNDS; roundNo++) {
      const format = formatSeq[roundNo - 1];
      const slot = {
        roundNo,
        format,
        filterOverride: null,
        questionId: null,
        chronoLevelId: null,
        source: 'AUTO',
        isPinned: false,
        isRed: false,
        payloadSnapshot: null,
      };

      if (format === 'CHRONO') {
        // some levels are unusable (bad order, wrong event count) — retry others
        let candidates = levelPool.filter((id) => !usedLevelIds.has(id));
        while (candidates.length && !slot.payloadSnapshot) {
          const levelId = pick(candidates);
          candidates = candidates.filter((id) => id !== levelId);
          const level = await chronoDb.collection('levels').findOne({
            _id: ObjectIdOf(levelId),
          });
          if (!level) continue;
          const facts = await chronoDb
            .collection('facts')
            .find({ _id: { $in: (level.factIds || []).map(ObjectIdOf) } })
            .toArray();
          const snapshot = chronoSnapshot(level, new Map(facts.map((f) => [String(f._id), f])));
          if (!snapshot) continue;
          slot.chronoLevelId = String(level._id);
          slot.payloadSnapshot = snapshot;
          usedLevelIds.add(String(level._id));
        }
        if (!slot.payloadSnapshot) {
          slot.isRed = true;
          slot.redReason = 'no usable chrono level left in chrono_db';
        }
      } else {
        const type = FORMAT_TO_TYPE[format];
        const candidates = questionPool[type].filter((id) => !usedQuestionIds.has(id));
        if (!candidates.length) {
          slot.isRed = true;
          slot.redReason = `no ${type} candidate left in questions_db (track ${TRACK})`;
        } else {
          const id = pick(candidates);
          const doc = await questionsCol.findOne({ _id: id });
          slot.questionId = doc._id;
          slot.payloadSnapshot = SNAPSHOT_BUILDERS[type](doc);
          usedQuestionIds.add(doc._id);
        }
      }
      slots.push(slot);
    }

    const redSlots = slots.filter((s) => s.isRed);
    // The contract forbids locking a set with RED slots — degrade to DRAFT loudly.
    const state = redSlots.length && STATE === 'LOCKED' ? 'DRAFT' : STATE;

    const now = new Date();
    const startAt = new Date(now.getTime() + START_IN_SECONDS * 1000);
    const autoLockAt = new Date(startAt.getTime() - 1000);

    const setDoc = {
      date: DATE,
      state,
      seed: SEED,
      startAt,
      autoLockAt,
      roundsTotal: ROUNDS,
      filter: { mode: 'any' },
      slots,
      auditLog: [
        {
          at: now,
          actor: 'testbed:make-survival-set',
          action: 'generate',
          details: { seed: SEED, rounds: ROUNDS, formats: FORMATS, track: TRACK, state },
        },
      ],
      generatorVersion: 1,
      createdAt: now,
      updatedAt: now,
    };

    await setsCol.createIndex({ date: 1 }, { unique: true, name: 'date_unique' });
    const res = await setsCol.replaceOne({ date: DATE }, setDoc, { upsert: true });
    const verb = res.upsertedCount ? 'inserted' : 'replaced';

    // ── printout: a human must be able to eyeball the whole set ──────────────
    line(` round  format   id            detail`);
    for (const s of slots) {
      const id = s.isRed ? '—' : String(s.payloadSnapshot.id);
      let detail = '';
      if (s.isRed) detail = `RED: ${s.redReason}`;
      else if (s.format === 'CHRONO') {
        detail = `level ${s.chronoLevelId} · ${s.payloadSnapshot.events.length} events`;
      } else {
        const en =
          s.payloadSnapshot.localizations.find((l) => l.language === 'en') ||
          s.payloadSnapshot.localizations[0];
        detail = (en && en.question ? en.question : '').slice(0, 60);
      }
      line(
        `${String(s.roundNo).padStart(6)}  ${s.format.padEnd(7)}  ${id.padEnd(12)}  ${detail}`,
      );
    }
    line();
    line(`${verb} ${SETS_DB}.survival_sets for ${DATE}`);
    line(`  state      ${state}${state !== STATE ? `  (requested ${STATE}, degraded: RED slots)` : ''}`);
    const startNote =
      START_IN_SECONDS >= 0
        ? `in ${START_IN_SECONDS}s`
        : `${-START_IN_SECONDS}s AGO — missed-start scenario`;
    line(`  startAt    ${startAt.toISOString()}  (${startNote})`);
    line(`  autoLockAt ${autoLockAt.toISOString()}`);
    line(`  seed       ${SEED}`);
    if (redSlots.length) {
      line();
      line(`FAILED: ${redSlots.length} RED slot(s) — the set is not playable as requested.`);
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

// levels/facts ids are ObjectIds, but an imported doc may carry plain hex strings
let ObjectIdCtor = null;
function ObjectIdOf(raw) {
  if (!ObjectIdCtor) ObjectIdCtor = require('mongodb').ObjectId;
  const key = String(raw);
  return ObjectIdCtor.isValid(key) ? new ObjectIdCtor(key) : key;
}

main().catch((err) => {
  line();
  line(`FAILED: ${err.message}`);
  if (err.name === 'MongoServerSelectionError') {
    line(`Could not reach mongo at ${MONGO_URL}.`);
    line('Start the testbed stack first (docker compose up -d mongo) or set MONGO_URL.');
  }
  process.exit(1);
});
