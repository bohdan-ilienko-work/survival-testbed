# survival-testbed

A **local, isolated** Battle of Geniuses stack for exercising Survival mode.
Every service is built from `../battleofgeniuses/<service>` but runs against a
**local mongo container** — nothing in this testbed ever talks to the remote
databases used by the source repo's `.env.dev`.

```
survival-testbed/
├── docker-compose.yml            the five services + mongo volume
├── .env.testbed                  all env vars, LOCAL values only
├── up.sh / down.sh               helpers (they pass --env-file .env.testbed)
├── docker/
│   └── survival-server.Dockerfile testbed build of survival-server
├── overrides/
│   └── main-server.env           neutral .env mounted over the baked-in one
├── gateway/                      JSTP↔WebSocket bridge for the browser (host)
└── web/                          React test client (host)
```

## Run it

```bash
cd /Users/bogdanilenko/Codebase/survival-testbed
./up.sh                 # == docker compose --env-file .env.testbed up -d --build
./down.sh               # stop, keep the mongo volume
./down.sh -v            # stop and wipe the mongo volume
```

Plain compose works too — just never forget the env file:

```bash
docker compose --env-file .env.testbed up -d --build
docker compose --env-file .env.testbed ps
docker compose --env-file .env.testbed logs -f survival-server
```

The first build takes a while: `main-server`, `fight-server` and
`survival-server` sit on node 10 / 12 base images that only ship usable native
`grpc` binaries for **linux/amd64**, so they are pinned to that platform and
built/run through Rosetta. `questions-api` (node 22) builds natively on arm64.

## Ports

| Service | Container port | Host port | Notes |
|---|---|---|---|
| mongo | 27017 | **27077** | `mongodb://127.0.0.1:27077` from the host |
| questions-api (editor HTTP) | 3001 | **3001** | `http://127.0.0.1:3001` |
| questions-api (game gRPC) | 5556 | **5556** | |
| main-server (JSTP clients) | 7000 | **7000** (on `127.0.0.1` only) and **7010** | see note below |
| main-server gRPC for fight | 5555 | not published | internal |
| main-server gRPC for survival | 5012 | not published | internal |
| fight-server (JSTP clients) | 7777 | **7777** | |
| fight-server gRPC | 5555 | not published | internal |
| survival-server (JSTP clients) | 4001 | **4001** | |
| survival-server gRPC | 5010 | **5010** | published for debugging |
| gateway (not in compose) | — | 8787 | `node gateway/index.js` on the host |

### The 7000 story

macOS reserves `*:7000` for the **AirPlay Receiver** (`ControlCenter`), so a
plain `-p 7000:7000` fails with *address already in use*. A bind to the
*specific* address `127.0.0.1:7000` is still allowed and takes precedence over
AirPlay's wildcard bind, so compose publishes main-server twice:

* `127.0.0.1:7000` — keeps `gateway/index.js`'s default working unchanged
* `0.0.0.0:7010` — a conflict-proof alternative

If AirPlay Receiver is ever disabled or something else grabs 7000, drop the
first `ports` entry for `main-server` and point the gateway at 7010 with
`MAIN_SERVER_PORT=7010`.

## Survival tunables

`.env.testbed` sets the knobs from `SURVIVAL_FIX_SPEC.md` §2 so a match is
playable in a couple of minutes instead of waiting for 17:00 UTC:

```
SURVIVAL_INSTANT_START=true
SURVIVAL_MIN_PLAYERS=4
SURVIVAL_ONBOARDING_MS=15000
SURVIVAL_ROUND_MS=20000
SURVIVAL_BUYBACK_MS=10000
SURVIVAL_ROUND_START_DELAY_MS=2000
SURVIVAL_START_HOUR_UTC=17
SURVIVAL_DISCONNECT_GRACE_MS=30000
SURVIVAL_MAX_ROUNDS=60
SURVIVAL_BOT_ACCURACY=0.6
```

`INTERNAL_API_TOKEN=testbed-token` is shared by questions-api (which gates
`GET /internal/survival_questions` on the `x-internal-token` header) and
survival-server.

```bash
curl -H 'x-internal-token: testbed-token' http://127.0.0.1:3001/internal/survival_questions
```

## Isolation — how the remote DB is kept out

`../battleofgeniuses/.env.dev` contains
`DB_URL=mongodb://root:…@165.227.143.145:27017` and
`../battleofgeniuses/main-server/.env` contains
`DB_URL=mongodb://95.216.114.174:27022`. Neither is used here:

1. `.env.testbed` is the **only** env file compose reads, and it sets
   `DB_URL` / `MONGO_URI` to `mongodb://mongo:27017`.
2. Every service's `environment:` block lists `DB_URL` explicitly, so the
   container environment always wins.
3. `main-server/server.js` calls `require("dotenv").config()` and its `.env` is
   baked into the image by that service's `.dockerignore` whitelist.
   `overrides/main-server.env` is mounted over `/home/server/.env` so the
   remote host is not even present inside the container.
4. `up.sh` greps `.env.testbed` for the known remote IPs and refuses to start
   if any of them reappear.

Verify at any time:

```bash
docker compose --env-file .env.testbed config | grep -E '165\.227|176\.9|95\.216'   # must print nothing
docker compose --env-file .env.testbed exec main-server env | grep -i 'DB_URL\|MONGO'
```

## Mongo

| From | Connection URL |
|---|---|
| the host (mongosh, Compass, seed scripts) | `mongodb://127.0.0.1:27077` |
| inside the compose network (what the services use) | `mongodb://mongo:27017` |

No authentication — it is a throwaway local database. Databases in use:
`quizdb` (main-server + fight-server), `questions_db` (questions-api),
`survival_db` (survival-server).

```bash
docker exec testbed-mongo mongo --quiet --eval 'db.adminCommand("listDatabases")'
```

## Seeding

The mongo volume starts **empty** and the servers boot fine that way, but
Survival needs questions: `survival-server` pulls its pool from `questions-api`
(`GET /internal/survival_questions` plus the game gRPC `getQuestionSetByQuery`),
which reads the local `questions_db`. Seed it over the host port:

```bash
mongorestore --uri mongodb://127.0.0.1:27077 --db questions_db <dump>
# or point any seeding script at mongodb://127.0.0.1:27077/questions_db
```

Check what is there:

```bash
curl -H 'x-internal-token: testbed-token' http://127.0.0.1:3001/internal/survival_questions | head -c 400
docker exec testbed-mongo mongo --quiet questions_db --eval 'db.questions.count()'
```

Note: with an **empty** `questions_db`, `/internal/survival_questions` answers
`500 {"error":"MongoError: query requires text score metadata, but it is not
available"}` — that is a questions-api query bug surfacing on empty data, not a
testbed misconfiguration. Once questions exist the endpoint returns the pool.

## Health probes

```bash
docker compose --env-file .env.testbed ps

# mongo
docker exec testbed-mongo mongo --quiet --eval 'db.adminCommand("ping")'        # { "ok" : 1 }

# questions-api
docker logs testbed-questions-api | head -2                                     # Listening on port: 3001 / Game question server listening on 5556
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/internal/survival_questions          # 401 without the token
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-internal-token: testbed-token' \
     http://127.0.0.1:3001/internal/survival_questions                          # 200 once questions_db is seeded

# main-server
docker logs testbed-main-server | grep -E 'JSTP listen|survival: mainServer'    # *:7000, survival gRPC 5012
docker logs testbed-main-server | grep 'Fight server is alive'                  # main -> fight gRPC handshake

# fight-server
docker logs testbed-fight-server | tail -3                                      # Connected to db / gRPC 5555 / JSTP 7777

# survival-server
docker logs testbed-survival-server | tail -3                                   # Connected to MongoDB / gRPC 5010 / JSTP 4001
```

End-to-end gRPC check (main-server calling survival-server, run from the host):

```bash
docker exec testbed-main-server node -e '
const pl=require("/home/server/node_modules/@grpc/proto-loader"),
      g=require("/home/server/node_modules/grpc"),
      s=g.loadPackageDefinition(pl.loadSync("/home/server/survival_server.proto")).survival_api,
      c=new s.SurvivalServerAPI("survival-server:5010", g.credentials.createInsecure());
c.getActiveLobby({json:"{}"},(e,r)=>{console.log(e?e.message:r.result);process.exit(0)});'
# -> {"lobbyId":"…","state":"BOOKING","playerCount":0,"activePlayerCount":0,
#     "scheduledStartAt":"…","round":0,"roster":[]}
```

`roster` is the full sign-up list (one row per player: `playerId, name, character,
flag, clan, isBot, slot, eliminated, eliminatedAtRound, ready`, in registration
order). main-server passes it straight through `beG.getSurvivalStatus`, which is
what the web client's booking panel draws — see `HOW-TO-TEST.md`.

## Services intentionally NOT in this testbed

`fight-bot`, `winrate-microservice`, `daily-tournaments-server`,
`academy-server`, `localization-*`, `questions-editor-ui`, `nginx`. main-server
still has env pointing at those hostnames (they simply do not resolve); bots are
disabled with `ENABLE_BOTS=false` so main-server does not retry a bot server
that is not running. Survival bots live *inside* survival-server, so this does
not affect Survival.
