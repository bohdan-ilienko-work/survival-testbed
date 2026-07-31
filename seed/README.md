# survival-testbed / seed

Populates the **local** testbed mongo with enough content that a Survival match and a
normal PvP fight can actually run.

## Run it

```sh
cd seed && npm install && node index.js
```

That's the one-liner. It is idempotent — run it as often as you like.

The mongo container must be up first (`docker compose --env-file .env.testbed up -d mongo`
from the repo root); `.env.testbed` publishes it on host port **27077**.

## Options

```sh
node index.js            # upsert everything (default)
node index.js --reset    # delete previously seeded docs, then re-insert
node index.js --verify   # no writes: just read back and print the counts
```

| env | default | meaning |
| --- | --- | --- |
| `MONGO_URL` | `mongodb://127.0.0.1:27077` | testbed mongo |
| `QUESTIONS_DB` | `questions_db` | questions-api database |
| `MAIN_DB` | `quizdb` | main-server / fight-server database |
| `SEED_LANGUAGES` | `en,uk` | localizations written on every question |
| `SEED_SKIP_MAIN_DB` | *(unset)* | set to `1` to leave `MAIN_DB` completely untouched |
| `SEED_GENERAL_CHOICE` | `60` | general choice questions per category |
| `SEED_GENERAL_NUMERICAL` | `25` | general numerical questions per category |
| `SEED_GENERAL_MAP` | `20` | general map questions (geography only) |
| `SEED_SURVIVAL_CHOICE` | `10` | survival choice questions per category |
| `SEED_SURVIVAL_NUMERICAL` | `2` | survival numerical questions per category |
| `SEED_SURVIVAL_MAP` | `12` | survival map questions |

## What gets written

Only into `QUESTIONS_DB`:

| collection | content |
| --- | --- |
| `categories` | the 5 root categories with the ids `getCategoryIdFromName()` hardcodes (history=1, geography=2, art=3, sport=4, science=5) plus 6 second-level categories each — `get-question-set-for-fight.ts` caps questions per second-level category, so several are required |
| `questions` | 517 docs: `track: 'survival'` (50 choice / 10 numerical / 12 map) and `track: 'general'` (300 choice / 125 numerical / 20 map), all `status: 'ready'`, `isValid: true`, `imageId: null`, `audioId: null`, `requiredLanguages: ['en','uk']` |
| `counters` | `question_id` and `category_id` bumped past the seeded id blocks so the questions editor never collides with seeded ids |

`MAIN_DB` only gets its `players` / `playedQuestions` collections created (empty) plus a
`playerId` index. **No player accounts are created** — the gateway signs up its own mock user
through main-server.

Every seeded document carries `seedBatch: "survival-testbed"`, and the script only ever
writes or deletes documents with that marker.

Ids live in reserved blocks: general questions `1000xx`, survival questions `2000xx`,
categories `1..5` and `11..56`.

## Why the questions look like they do

* **Answers are obvious.** Curated trivia with one unmistakable answer, plus arithmetic
  (`What is 47 + 25?`). A human tester can tell at a glance whether the server scored the
  round correctly.
* **Question text is prefixed** with the track and category — `[S/geography] ...` for
  survival, `[G/history] ...` for general — so it is visible in-game which pool a round
  came from.
* **The correct option is deliberately *not* at index 0.** The survival payload exposes
  `correct = shuffledAnswers.indexOf(0)`; `survival-server/src/survivalQuestionProvider.ts`
  currently hardcodes `correct: 0` when it builds its queue from
  `/internal/survival_questions`. The seed spreads correct answers across positions
  0-3 (position 0 only 1 time in 8) so that bug shows up immediately instead of hiding.
  The verify step prints the position histogram.

## Verification

After writing, the script re-runs the *real* queries against mongo and prints the results:

* the survival filter that `get-questions-for-survival.ts` produces —
  `{$and: [{track: {$in: ['survival']}}, {status: {$in: ['ready']}}, {isValid: true}]}` —
  with the payload rebuilt exactly like `documentToQuestion` + `questionToGame` do, so the
  printed `correct` index is what survival-server will actually receive;
* the fight filter from `questions-db.ts generateQuery()`, counted per category / type /
  difficulty window, because `getDifficultiesByCups()` narrows to difficulty 1 only for a
  fresh account under 800 cups.
