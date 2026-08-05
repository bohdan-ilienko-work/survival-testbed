'use strict';

// Headless end-to-end check of the Survival flow.
//
//   node e2e/run-match.js [--players 3] [--accuracy 0.7]
//
// Each simulated player signs up + signs in on main-server, joins survival through
// the real beG.joinSurvival RPC, connects to survival-server with the returned
// token and then answers every round. Prints the whole flow and exits non-zero if
// the match never finishes (the classic "fight hangs forever" failure).
//
// Registration and the socket are deliberately two separate phases, the way a real client
// does it: beG.getSurvivalStatus is probed once before anybody joins and once after
// everybody has, while not a single survival-server connection is open — that reply is the
// only thing the booking/registration popup ever gets to build its participant list from.

const path = require('path');
const jstp = require(path.join(__dirname, '..', 'gateway', 'node_modules', 'metarhia-jstp'));

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const PLAYERS = parseInt(arg('players', '3'), 10);
const ACCURACY = parseFloat(arg('accuracy', '0.7'));
const MATCH_TIMEOUT_MS = parseInt(arg('timeout', '600000'), 10);
// Starting wallet, granted ON TOP of the free daily ticket that joinSurvival claims for
// every fresh account (SURVIVAL_FREE_DAILY_TICKETS, default 1). Lower it (e.g. --tickets 3)
// to reach the insufficient-funds BuyBack denial — 50 covers every attempt.
// --tickets 0 is the exact-fee mode: the grant is skipped entirely (main-server rejects a
// zero grant as 'Invalid amount' anyway), so the free daily ticket IS the whole wallet —
// exactly the audited "fresh player with only the free daily ticket". main-server charges
// the fee down to 0 and survival-server receives a post-charge balance of 0, which it must
// accept; re-testing that balance against the fee is the double-charge regression. The
// summary then prints 'entry with exact fee: ok'; BuyBack attempts are simply denied.
// (--tickets 1 does NOT exercise that regression: with the free daily on top the wallet at
// charge time is 2 and the post-charge balance 1, which even the buggy gate accepted.)
const START_TICKETS = parseInt(arg('tickets', '50'), 10);
// Assert that the match plays today's predefined set (db survival_factory) slot by
// slot: round modes AND question ids in order. Seed the set first with
// `node seed/make-survival-set.js --state LOCKED`. Without the flag nothing changes.
const EXPECT_SET = process.argv.includes('--expect-set');

const MAIN = {
  host: process.env.MAIN_SERVER_HOST || '127.0.0.1',
  port: parseInt(process.env.MAIN_SERVER_PORT || '7000', 10),
  protocol: process.env.MAIN_SERVER_PROTOCOL || 'net',
};
const SURVIVAL = {
  host: process.env.SURVIVAL_SERVER_HOST || '127.0.0.1',
  port: parseInt(process.env.SURVIVAL_SERVER_PORT || '4001', 10),
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function connect(protocol, app, interfaces, port, host) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`connect timeout ${host}:${port}`)), 10000);
    jstp[protocol].connectAndInspect(app, null, interfaces, port, host, (err, connection, api) => {
      clearTimeout(t);
      err ? reject(err) : resolve({ connection, api });
    });
  });
}

// jstp delivers RPC results wrapped as { res: [value] }, and application errors
// come back as a successful callback carrying { error: {...} }.
const unwrap = (r) => {
  const v = r && Array.isArray(r.res) ? (r.res.length <= 1 ? r.res[0] : r.res) : r;
  if (v && v.error) throw new Error(v.error.description || JSON.stringify(v.error));
  return v;
};

const call = (api, iface, method, args) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${iface}.${method} timeout`)), 20000);
    api[iface][method](...args, (err, ...rest) => {
      clearTimeout(t);
      if (err) return reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
      try {
        resolve(unwrap(rest[0]));
      } catch (e) {
        reject(e);
      }
    });
  });

// Build a plausible answer for whatever the round asks.
function answerFor(question, mode, wantCorrect) {
  const m = mode || question.mode;
  if (m === 'MAP') {
    const lat = wantCorrect ? 50 + Math.random() * 0.2 : Math.random() * 160 - 80;
    const lng = wantCorrect ? 30 + Math.random() * 0.2 : Math.random() * 360 - 180;
    return { type: 'map', lat, lng };
  }
  if (m === 'CHRONO') {
    // CHRONO is a MATCHING round: pairs[i] is the index into `years` chosen for events[i].
    // (It also used to read `question.facts`, a field the wire never carried — the payload
    // field is `events`.) The harness cannot know the true pairing, so "correct" here just
    // means a WELL-FORMED answer: isChronoAnswer rejects duplicate indices and a wrong length
    // outright, and an ill-formed answer scores 0 without proving anything about the round.
    const events = question.events || [];
    const yearCount = (question.years || []).length;
    const pairs = events.map((_, i) => (i < yearCount ? i : -1));
    // A rotation keeps every index distinct — still a legal answer, just a different one
    if (!wantCorrect && yearCount > 1) {
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i] !== -1) pairs[i] = (pairs[i] + 1) % yearCount;
      }
    }
    return { type: 'chrono', pairs };
  }
  if (m === 'NUMBER') {
    return { type: 'number', value: wantCorrect ? 1000 : Math.floor(Math.random() * 1e6) };
  }
  const n = (question.options || []).length || 4;
  return { type: 'selection', optionId: Math.floor(Math.random() * n) };
}

// main-server returns a JWT that carries accountId + playerId.
function playerIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8'));
    return payload.playerId;
  } catch {
    return undefined;
  }
}

// Testbed-only: new accounts start with 0 tickets. Top them up through the real
// MainServerAPI.GrantTickets gRPC so main-server's player cache and moneyFlow stay
// consistent (a direct mongo write would be invisible to the cached player).
function grantTickets(playerIds, amount) {
  const gwModules = path.join(__dirname, '..', 'gateway', 'node_modules');
  const grpc = require(path.join(gwModules, '@grpc', 'grpc-js'));
  const protoLoader = require(path.join(gwModules, '@grpc', 'proto-loader'));
  const protoPath = path.join(__dirname, '..', '..', 'battleofgeniuses', 'proto', 'survival_server.proto');
  const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(protoPath)).survival_api;
  const addr = process.env.MAIN_SERVER_GRPC || '127.0.0.1:5012';
  const client = new pkg.MainServerAPI(addr, grpc.credentials.createInsecure());

  return Promise.all(
    playerIds.map(
      (playerId) =>
        new Promise((resolve) => {
          client.grantTickets(
            { json: JSON.stringify({ playerId, amount, reason: 'testbed' }) },
            (err, res) => {
              if (err) log(`grantTickets ${playerId} ✗ ${err.message}`);
              resolve(res);
            },
          );
        }),
    ),
  ).then((rs) => log(`granted ${amount} tickets to ${rs.filter(Boolean).length}/${playerIds.length} players`));
}

async function makePlayer(index) {
  const { api: mainApi } = await connect(MAIN.protocol, 'beGenius', ['beG', 'auth'], MAIN.port, MAIN.host);

  const signUp = await call(mainApi, 'auth', 'signUp', [
    { language: 'en', character: index % 5, categories: ['history', 'geography', 'sport'], isTrial: false },
  ]);
  const accountId = String(signUp?.accountId || signUp?.id || signUp);
  const deviceId = `e2e-${index}-${Math.random().toString(16).slice(2, 8)}`;
  const signIn = await call(mainApi, 'auth', 'signIn', [accountId, deviceId, 'E2E', {}]);
  const playerId = playerIdFromToken(signIn?.token);

  log(`player${index}: signed in ${playerId}`);
  return { index, mainApi, accountId, playerId, name: `p${index}` };
}

/**
 * The registration half, and nothing else. Split from the socket half on purpose: a real
 * client books its seat from the main menu and only connects when the match is about to
 * start, and in between the booking popup has beG.getSurvivalStatus and nothing else. Doing
 * the same here is what lets the roster probe run with no survival-server socket open at all
 * — otherwise the roster it sees could have arrived over the JSTP session and would prove
 * nothing. The seat survives the wait: survival.connect only needs the token, which lives
 * ten minutes.
 */
async function registerSurvival(p) {
  const res = await call(p.mainApi, 'beG', 'joinSurvival', []);
  // Counted, not assumed: a failed join throws and kills the run, but the exact-fee summary
  // line below must state the positive fact, not infer it from "we did not crash".
  seen.joinsOk++;
  p.joinResult = res;
  log(`player${p.index}: joinSurvival →`, JSON.stringify(res).slice(0, 160));
  return res;
}

/** The socket half: redeem the token registerSurvival got and bind the JSTP session. */
async function connectSurvival(p) {
  const res = p.joinResult;

  const { connection, api } = await connect('net', 'survival', ['survival'], SURVIVAL.port, SURVIVAL.host);
  p.survivalApi = api;
  p.survivalConnection = connection;

  // Subscribe BEFORE survival.connect, not after. The server pushes the first
  // 'ticketsUpdated' (reason 'initial') immediately after that RPC replies, and both
  // packets can arrive in the same chunk — a listener attached after the await is
  // registered a microtask too late and the balance push is silently lost.
  connection.on('event', (iface, name, args) => onEvent(p, name, args?.[0] || {}));

  if (res && res.token) {
    const bound = await call(api, 'survival', 'connect', [[res.token]]);
    // The reply's roster is the only way a player joining an in-progress lobby learns who is
    // already there — their own `playerJoined` broadcast went out before this socket existed.
    // A client that drops it renders an empty lobby for the whole on-boarding, which is a real
    // bug that shipped once, so it is asserted rather than merely logged.
    const roster = Array.isArray(bound && bound.roster) ? bound.roster : null;
    seen.connectRosters.push({ player: p.index, size: roster ? roster.length : null });
    if (!roster || roster.length === 0) {
      seen.errors.push(`player${p.index}: survival.connect returned no roster`);
    }
    log(`player${p.index}: connect → roster ${roster ? roster.length : 'MISSING'}`);
  }
  return res;
}

const seen = {
  finished: false,
  rounds: 0,
  modes: {},
  /** every roundStarted in arrival order (player 0 only): { round, mode, questionId } */
  roundLog: [],
  eliminated: new Set(),
  errors: [],
  /** roster size each player received in its own survival.connect reply */
  connectRosters: [],
  /** successful beG.joinSurvival calls — with --tickets 0 this proves exact-fee entry works */
  joinsOk: 0,

  // ─── the booking roster, read with no survival-server socket open ──────────
  /** every beG.getSurvivalStatus probe in order — the registration popup's whole data source */
  bookingProbes: [],
  /** where our own players sit in the post-registration booking roster; -1 = not listed at all */
  bookingSelfIndices: [],
  /** roster rows the popup could not render, field by field (kept apart so errors stay readable) */
  rosterShapeIssues: [],

  // ─── the wallet pushes, so a regression is caught here and not by a human ───
  /** every 'ticketsUpdated' the run received; 0 means the server never pushed */
  ticketsUpdated: 0,
  /** which players got at least one push — the contract says every connect gets one */
  ticketsPlayers: new Set(),
  /** reason tag -> count ('initial', 'buyback', 'ad_reward', …) */
  ticketsReasons: {},
  /** the private per-player price offers */
  offers: [],
  /** every BuyBack denial reason we managed to observe, RPC or event */
  denials: [],
  buyBackOk: 0,
  /** event names this script does not handle — catches a casing slip in a new event */
  otherEvents: new Set(),
};

// ─── the booking roster: everything beG.getSurvivalStatus alone has to carry ──

/**
 * The fields the registration popup draws a row from: the row NUMBER (the array index —
 * `slot` is still null while the lobby is booking), the country flag, the character avatar,
 * the nickname and the clan name. A field of the wrong type is a blank cell or a crashed
 * render, so the types are asserted here instead of being discovered by the UI.
 * `clan` is the new one: the clan NAME, '' for a player in no clan and for every bot —
 * never undefined, which is why its type is checked and its value is not.
 */
const ROSTER_FIELD_TYPES = {
  playerId: 'string',
  name: 'string',
  character: 'number',
  flag: 'string',
  clan: 'string',
  isBot: 'boolean',
  eliminated: 'boolean',
  ready: 'boolean',
};

/** `slot` is null until on-boarding assigns one, `eliminatedAtRound` until the player is out */
const ROSTER_NULLABLE_NUMBERS = ['slot', 'eliminatedAtRound'];

/** @returns {string[]} one message per bad field — a wrong type and a missing field read alike */
function rosterShapeProblems(roster, phase) {
  const problems = [];
  roster.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      problems.push(`${phase} roster[${i}] is ${entry === null ? 'null' : typeof entry}, want an object`);
      return;
    }
    const describe = (value) => (value === undefined ? 'missing' : typeof value);
    for (const [field, type] of Object.entries(ROSTER_FIELD_TYPES)) {
      if (typeof entry[field] !== type) {
        problems.push(`${phase} roster[${i}].${field} is ${describe(entry[field])}, want ${type}`);
      }
    }
    for (const field of ROSTER_NULLABLE_NUMBERS) {
      if (entry[field] !== null && typeof entry[field] !== 'number') {
        problems.push(`${phase} roster[${i}].${field} is ${describe(entry[field])}, want number|null`);
      }
    }
  });
  return problems;
}

/**
 * One beG.getSurvivalStatus call plus the checks that hold in every phase.
 *
 * This RPC is the entire data source of the registration popup: the screen is opened from the
 * main menu hours before the match and a survival connect token lives ten minutes, so it never
 * has a survival-server session to ask. The count, the scheduled start, whether I am in and the
 * participant list all have to arrive on this one reply.
 *
 * Nothing off the wire is trusted by declaration — same discipline as web/src/survival.ts's
 * asPlayers/asNum guards, and for the same reason: a count arriving where a list is declared
 * must be reported, never quietly used.
 *
 * @returns {{ status: object, lobby: object|null, roster: object[] }} `roster` is [] when the
 * reply carried none, so callers can go on asserting without a null dance.
 */
async function readBookingStatus(p, phase) {
  const status = await call(p.mainApi, 'beG', 'getSurvivalStatus', []);
  const lobby = status && typeof status.lobby === 'object' && status.lobby !== null ? status.lobby : null;

  const probe = {
    phase,
    available: !!(status && status.available === true),
    registered: !!(status && status.registered === true),
    lobbyId: lobby ? lobby.lobbyId : null,
    state: lobby ? lobby.state : null,
    playerCount: lobby ? lobby.playerCount : null,
    /** stays null when `roster` was not an array at all — see the check below */
    roster: null,
    /** rows carrying a non-empty clan name */
    clans: null,
  };
  seen.bookingProbes.push(probe);

  // main-server flips `available` only once GetActiveLobby has answered, so false means it
  // could not reach survival-server at all — every join after this point would fail too.
  if (!probe.available) {
    seen.errors.push(`getSurvivalStatus (${phase}): available=false, main-server cannot reach survival-server`);
  }

  if (!lobby) {
    // Recorded rather than assumed: with no lobby the popup has nothing to list, and only the
    // phase-specific caller knows whether that is legal (before a join) or a fault (after one).
    log(`player${p.index}: getSurvivalStatus (${phase}) → NO ACTIVE LOBBY · registered=${probe.registered}`);
    return { status, lobby: null, roster: [] };
  }

  // THE new field. Its absence means the deployed survival-server predates the booking roster
  // (GetActiveLobby used to answer with aggregates only) — exactly the regression this probe
  // exists for, because the popup then renders "48 players registered" above an empty list.
  if (!Array.isArray(lobby.roster)) {
    const got = lobby.roster === undefined ? 'missing' : typeof lobby.roster;
    seen.errors.push(
      `getSurvivalStatus (${phase}): lobby.roster is ${got} — survival-server predates the booking roster`,
    );
    log(`player${p.index}: getSurvivalStatus (${phase}) → roster MISSING · playerCount=${lobby.playerCount}`);
    return { status, lobby, roster: [] };
  }

  const roster = lobby.roster;
  probe.roster = roster.length;

  // playerCount is the number the popup prints as "N гравців зареєстровано" and the roster is
  // the list under it. Both come off the same lobby, so a disagreement means the screen lies.
  if (lobby.playerCount !== roster.length) {
    seen.errors.push(
      `getSurvivalStatus (${phase}): playerCount ${JSON.stringify(lobby.playerCount)} != roster length ${roster.length}`,
    );
  }

  const problems = rosterShapeProblems(roster, phase);
  if (problems.length) {
    seen.rosterShapeIssues.push(...problems);
    // Capped on the way into `errors`: a lobby of 48 malformed rows would bury every other
    // line of the summary, and the first few name the broken field just as well.
    seen.errors.push(...problems.slice(0, 4));
    if (problems.length > 4) seen.errors.push(`…and ${problems.length - 4} more roster shape problem(s)`);
  }

  // Rows are numbered 1..N from the array index, so the same playerId twice is two rows for one
  // person. The lobby keys its players by id, so a duplicate can only have appeared on the wire.
  const ids = new Set(roster.map((e) => e && e.playerId));
  if (ids.size !== roster.length) {
    seen.errors.push(`getSurvivalStatus (${phase}): roster has ${roster.length - ids.size} duplicate playerId(s)`);
  }

  // An observation, not an assertion: e2e accounts are freshly signed up and belong to no clan,
  // so 0 is the honest expectation here. The populated-clan path is driven from the web testbed,
  // which puts its account in a clan through the gateway's mockClan call first.
  probe.clans = roster.filter((e) => e && typeof e.clan === 'string' && e.clan !== '').length;

  log(
    `player${p.index}: getSurvivalStatus (${phase}) → lobby ${lobby.lobbyId} · ${lobby.state}` +
      ` · playerCount=${lobby.playerCount} · roster ${roster.length} (${probe.clans} with a clan)` +
      ` · registered=${probe.registered} · start ${lobby.scheduledStartAt}`,
  );
  return { status, lobby, roster };
}

/**
 * The popup as it opens from the main menu: this account has paid for nothing, so the lobby
 * and its roster have to be readable before it has any relationship with the lobby at all.
 * @returns {string[]} playerIds already listed — the testbed lobby is shared, so an earlier run
 * or an open browser tab legitimately leaves rows behind, and the count is worth printing.
 */
async function probeBookingBeforeJoin(p) {
  const { status, lobby, roster } = await readBookingStatus(p, 'before join');

  // `registered` is main-server's paid-entry answer for THIS account and nothing has been
  // charged yet, so a true here means a paid entry leaked across accounts or across lobbies.
  if (status && status.registered !== false) {
    seen.errors.push(
      `getSurvivalStatus (before join): registered=${JSON.stringify(status.registered)} before any joinSurvival`,
    );
  }
  if (!lobby) log('no lobby to book into yet — the roster assertions below start from nothing');
  return roster.map((e) => e && e.playerId);
}

/**
 * THE assertion of the whole feature: every player holds a seat and not one survival-server
 * socket exists yet, so a roster arriving here can only have travelled beG.getSurvivalStatus →
 * main-server → GetActiveLobby. That path is all the booking screen will ever have.
 */
async function probeBookingAfterJoin(p, ours, alreadyThere) {
  const { status, lobby, roster } = await readBookingStatus(p, 'after join');

  if (!lobby) {
    seen.errors.push('getSurvivalStatus (after join): no active lobby, yet every player just registered into one');
    return;
  }
  if (status && status.registered !== true) {
    seen.errors.push(
      `getSurvivalStatus (after join): registered=${JSON.stringify(status.registered)} after joinSurvival succeeded`,
    );
  }

  // -1 is the booking screen telling a player their own seat does not exist.
  const indices = ours.map((q) => roster.findIndex((e) => e && e.playerId === q.playerId));
  seen.bookingSelfIndices = indices;
  ours.forEach((q, i) => {
    if (indices[i] < 0) {
      seen.errors.push(`getSurvivalStatus (after join): roster does not list player${q.index} (${q.playerId})`);
    }
  });

  // ORDER IS PART OF THE CONTRACT (see SurvivalLobby.getRoster): entries come back in
  // registration order, and the popup numbers its rows 1..N from the array index because
  // `slot` is still null while booking — so a roster sorted or filtered on the way here
  // renumbers everyone. Registration in this script is strictly sequential (the join loop
  // awaits each player before starting the next), so our players' indices are deterministic
  // and must increase. Only their order RELATIVE to each other is asserted: the testbed lobby
  // is shared, so rows from an earlier run or an open browser tab sit before ours and can
  // disappear between the two probes, which shifts absolute positions without breaking the
  // contract.
  const found = indices.filter((i) => i >= 0);
  if (!found.every((idx, i) => i === 0 || found[i - 1] < idx)) {
    seen.errors.push(
      `getSurvivalStatus (after join): roster is not in registration order, our players sit at [${indices.join(', ')}]`,
    );
  }

  log(
    `booking roster: ${roster.length} row(s) · our players at [${indices.join(', ')}]` +
      ` · ${alreadyThere.length} row(s) were already there before we joined`,
  );
}

/**
 * Both new events are PRIVATE: the server addresses them to one socket. If a payload
 * for somebody else shows up here, that is a privacy regression, not a detail.
 */
function assertAddressedToMe(p, name, payload) {
  if (!payload.playerId || !p.playerId || payload.playerId === p.playerId) return true;
  const msg = `${name} for ${payload.playerId} arrived on player${p.index} (${p.playerId})`;
  seen.errors.push(`PRIVACY: ${msg}`);
  log(`✗ PRIVACY: ${msg}`);
  return false;
}

function onEvent(p, name, payload) {
  switch (name) {
    case 'roundStarted': {
      if (p.index === 0) {
        seen.rounds = Math.max(seen.rounds, payload.round || 0);
        seen.modes[payload.mode] = (seen.modes[payload.mode] || 0) + 1;
        // ordered log for --expect-set: tiebreaks arrive as 'tiebreakStarted',
        // so this sequence maps 1:1 onto a predefined set's slots
        seen.roundLog.push({
          round: payload.round,
          mode: payload.mode,
          questionId: payload.question ? payload.question.id : undefined,
        });
        log(`round ${payload.round} · ${payload.mode} · deadline in ${Math.round(((payload.deadline || 0) - Date.now()) / 1000)}s`);
      }
      if (seen.eliminated.has(p.playerId)) return;
      const wantCorrect = Math.random() < ACCURACY;
      const answer = answerFor(payload.question || {}, payload.mode, wantCorrect);
      const delay = 500 + Math.random() * 2500;
      setTimeout(() => {
        call(p.survivalApi, 'survival', 'submitAnswer', [[answer]]).catch((e) =>
          log(`player${p.index}: submitAnswer ✗ ${e.message}`),
        );
      }, delay);
      break;
    }
    case 'roundResult':
      if (p.index === 0) {
        const out = (payload.eliminated || []).length;
        log(`  → result: ${(payload.scores || []).length} scored, ${out} eliminated` +
            (payload.correctAnswer !== undefined ? `, correct=${JSON.stringify(payload.correctAnswer)}` : ''));
      }
      (payload.eliminated || []).forEach((id) => seen.eliminated.add(id));
      break;
    case 'playerEliminated':
      seen.eliminated.add(payload.playerId);
      if (payload.playerId === p.playerId) log(`player${p.index}: eliminated in round ${payload.round}`);
      break;
    // Broadcast: carries no wallet data at all. The price lives on the private
    // 'buyBackOffer' below.
    case 'buybackWindowOpen':
      if (seen.eliminated.has(p.playerId) && p.index === 0) attemptBuyBack(p);
      break;

    // PRIVATE, per-player: this player's price for this attempt.
    case 'buyBackOffer': {
      if (!assertAddressedToMe(p, name, payload)) break;
      const offer = {
        player: p.index,
        round: payload.round,
        cost: payload.cost,
        attempt: payload.attempt,
        maxUses: payload.maxUses,
        balance: payload.balance,
        affordable: payload.affordable,
        unavailableReason: payload.unavailableReason,
      };
      seen.offers.push(offer);
      log(
        `player${p.index}: buyBackOffer · cost=${payload.cost === null ? 'null' : payload.cost}` +
          ` · attempt ${payload.attempt}/${payload.maxUses}` +
          ` · balance=${payload.balance} · affordable=${payload.affordable}` +
          (payload.unavailableReason ? ` · unavailable=${payload.unavailableReason}` : ''),
      );
      // cost:null is only meaningful with a reason — that is the whole point of the fix
      if (payload.cost === null && !payload.unavailableReason) {
        seen.errors.push('buyBackOffer sent cost:null with no unavailableReason');
      }
      break;
    }

    // PRIVATE: the machine reason, straight from the lobby.
    case 'buyBackDenied': {
      if (!assertAddressedToMe(p, name, payload)) break;
      const reason = payload.reason || 'MISSING';
      seen.denials.push(`event:${reason}`);
      log(`player${p.index}: buyBackDenied · reason=${reason}`);
      if (reason === 'MISSING') seen.errors.push('buyBackDenied carried no reason');
      break;
    }

    case 'buyBackSuccess':
      // counted from the RPC reply in attemptBuyBack(); here it only puts the player
      // back in the round so the next 'roundStarted' answers again
      if (payload.playerId === p.playerId) {
        seen.eliminated.delete(p.playerId);
        log(`player${p.index}: buyBackSuccess · back in the round`);
      }
      break;

    // PRIVATE: problem (3). The balance must be PUSHED, with no client poll.
    case 'ticketsUpdated': {
      if (!assertAddressedToMe(p, name, payload)) break;
      const reason = payload.reason || 'unspecified';
      seen.ticketsUpdated++;
      seen.ticketsPlayers.add(p.index);
      seen.ticketsReasons[reason] = (seen.ticketsReasons[reason] || 0) + 1;
      const delta =
        typeof payload.delta === 'number' ? ` (${payload.delta > 0 ? '+' : ''}${payload.delta})` : '';
      log(`player${p.index}: ticketsUpdated · balance=${payload.balance}${delta} · ${reason}`);
      if (typeof payload.balance !== 'number') {
        seen.errors.push(`ticketsUpdated balance is not a number (${JSON.stringify(payload.balance)}, ${reason})`);
      }
      break;
    }
    case 'fightFinished':
    case 'lobbyFinished':
      if (!seen.finished) {
        seen.finished = true;
        log(`MATCH FINISHED · winner=${payload.winnerId} · rounds=${payload.totalRounds}`);
      }
      break;
    case 'fightError':
      seen.errors.push(payload.reason || 'unknown');
      log('fightError:', JSON.stringify(payload));
      break;
    case 'lobbyCancelled':
      seen.errors.push('lobbyCancelled');
      log('lobbyCancelled');
      break;

    // A new event whose name is misspelled (or cased differently) reaches the socket and
    // is then dropped by this switch — exactly the symptom "nothing happens in the UI".
    // Record the names so the summary shows what was ignored.
    default:
      if (p.index === 0) seen.otherEvents.add(name);
      break;
  }
}

/**
 * Ask for the price first, then spend. Both halves print the real machine reason:
 * survival.buyBack now rejects with the tag itself instead of a hardcoded
 * 'BuyBack denied', and the gateway/unwrap path surfaces error.description verbatim.
 */
function attemptBuyBack(p) {
  return call(p.survivalApi, 'survival', 'getBuyBackQuote', [[]])
    .then((q) => log(`player${p.index}: getBuyBackQuote → ${JSON.stringify(q)}`))
    .catch((e) => {
      // Two benign cases, both facts for the log rather than failures: an older server has no
      // such method at all, and a player eliminated in the deciding round can see the lobby
      // finish before their quote lands. Everything else is a real fault and fails the run.
      log(`player${p.index}: getBuyBackQuote ✗ ${e.message}`);
      if (!/no method|not a function|lobby has ended/i.test(e.message)) {
        seen.errors.push(`getBuyBackQuote: ${e.message}`);
      }
    })
    .then(() => call(p.survivalApi, 'survival', 'buyBack', [[]]))
    .then((r) => {
      seen.buyBackOk++;
      log(`player${p.index}: buyBack ok ${JSON.stringify(r)}`);
    })
    .catch((e) => {
      seen.denials.push(`rpc:${e.message}`);
      log(`player${p.index}: buyBack DENIED · reason=${e.message}`);
      // problem (1): the generic string means the RPC threw the real reason away again
      if (/^\s*buyback denied\s*$/i.test(e.message)) {
        seen.errors.push('buyBack rejected with the generic "BuyBack denied" — real reason lost');
      }
    });
}

// ─── --expect-set: the predefined daily set the match must reproduce ─────────

// slot.format -> the RoundMode the fight broadcasts (fixed contract mapping)
const FORMAT_TO_MODE = { CHOICE: 'QUESTION', NUMERIC: 'NUMBER', MAP: 'MAP', CHRONO: 'CHRONO' };

/** Reads today's set from the testbed mongo (host-published port, like the seeds). */
async function loadTodaySet() {
  // same driver the seeds use; e2e has no node_modules of its own
  const { MongoClient } = require(path.join(__dirname, '..', 'seed', 'node_modules', 'mongodb'));
  const url = process.env.MONGO_URL || 'mongodb://127.0.0.1:27077';
  const dbName = process.env.SETS_DB || 'survival_factory';
  const date = new Date().toISOString().slice(0, 10);
  const client = await MongoClient.connect(url, { serverSelectionTimeoutMS: 5000 });
  try {
    const set = await client.db(dbName).collection('survival_sets').findOne({ date });
    if (!set) {
      seen.errors.push(`--expect-set: no set for ${date} in ${dbName} — run seed/make-survival-set.js first`);
      return null;
    }
    const slots = (set.slots || []).slice().sort((a, b) => a.roundNo - b.roundNo);
    log(`expect-set: ${date} · state=${set.state} · ${slots.length} slots · startAt=${new Date(set.startAt).toISOString()}`);
    return { ...set, slots };
  } finally {
    await client.close();
  }
}

/**
 * Observed rounds vs the set's slots, index-aligned. Rounds beyond the set's
 * slots are legal (buyback overflow falls back to the legacy provider), and so
 * is finishing early (a winner can be decided before the last slot) — only a
 * played round that CONTRADICTS its slot fails the run.
 */
function checkAgainstSet(set) {
  const compare = Math.min(seen.roundLog.length, set.slots.length);
  let matched = 0;
  if (compare === 0) {
    seen.errors.push('--expect-set: no rounds observed, nothing to compare');
    return { matched, compare };
  }
  for (let i = 0; i < compare; i++) {
    const slot = set.slots[i];
    const got = seen.roundLog[i];
    const wantMode = FORMAT_TO_MODE[slot.format] || slot.format;
    const wantId = slot.payloadSnapshot ? String(slot.payloadSnapshot.id) : null;
    const problems = [];
    if (got.round !== slot.roundNo) problems.push(`round ${got.round} != slot ${slot.roundNo}`);
    if (got.mode !== wantMode) problems.push(`mode ${got.mode} != ${wantMode} (${slot.format})`);
    // question.id survives publicQuestion + localizePayload, so identity is observable
    if (wantId !== null && String(got.questionId) !== wantId) {
      problems.push(`question id ${got.questionId} != ${wantId}`);
    }
    if (problems.length) {
      seen.errors.push(`set slot ${slot.roundNo}: ${problems.join('; ')}`);
    } else {
      matched++;
    }
  }
  if (seen.roundLog.length > set.slots.length) {
    log(`expect-set: ${seen.roundLog.length - set.slots.length} overflow round(s) beyond the set (legacy fallback)`);
  }
  return { matched, compare };
}

(async () => {
  log(`main-server ${MAIN.host}:${MAIN.port} · survival ${SURVIVAL.host}:${SURVIVAL.port}`);

  const expectedSet = EXPECT_SET ? await loadTodaySet() : null;

  const players = [];
  for (let i = 0; i < PLAYERS; i++) players.push(await makePlayer(i));

  if (START_TICKETS > 0) {
    await grantTickets(players.map((p) => p.playerId).filter(Boolean), START_TICKETS);
  } else {
    // Exact-fee mode: no grant — each wallet holds only the free daily ticket that
    // joinSurvival claims, so the entry charge empties it to exactly 0.
    log('no tickets granted (--tickets 0): wallets hold only the free daily ticket');
  }

  // One prober is enough: only `registered` and `tickets` are per-account, the lobby half of
  // the reply is the same for everyone looking at the booking screen.
  const prober = players[0];

  // Booking screen, opened before anything is paid for. getSurvivalStatus claims the free daily
  // ticket exactly as joinSurvival does, and the claim is stamped on the player document — so
  // this probe cannot inflate a wallet, and --tickets 0 still enters on that one free ticket.
  const alreadyThere = prober ? await probeBookingBeforeJoin(prober) : [];

  for (const p of players) await registerSurvival(p);

  // Booking screen again, now that every seat is booked and BEFORE the first socket exists.
  if (prober) await probeBookingAfterJoin(prober, players, alreadyThere);

  for (const p of players) await connectSurvival(p);

  log(`${players.length} players in the lobby, waiting for the match…`);

  const started = Date.now();
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (seen.finished || Date.now() - started > MATCH_TIMEOUT_MS) {
        clearInterval(t);
        resolve();
      }
    }, 500);
  });

  // ── assertions on the wallet pushes ───────────────────────────────────────────
  // The balance used to move only when a human clicked "Тікети". The server now pushes
  // 'ticketsUpdated' on every authoritative change, starting with one per successful
  // survival.connect — so zero of them is a regression, and this run must fail on it.
  const missingPush = players.filter((p) => !seen.ticketsPlayers.has(p.index)).map((p) => `p${p.index}`);
  if (seen.ticketsUpdated === 0) {
    seen.errors.push('no ticketsUpdated received — the server never pushed a balance');
  }

  // ── assertions on the predefined set (only with --expect-set) ─────────────────
  const setCheck = EXPECT_SET && expectedSet ? checkAgainstSet(expectedSet) : null;

  // ── exact-fee entry (only with --tickets 0) ───────────────────────────────────
  // The wallet holds exactly the entry cost (the free daily ticket alone — no grant), so
  // main-server charges it down to 0 and survival-server receives a post-charge balance of
  // 0 — which it must accept. The double-charge regression (re-testing that balance against
  // the fee) rejects every join and kills the run long before this line; the summary row
  // makes the green path visible.
  const exactFeeOk = START_TICKETS === 0 ? seen.joinsOk === PLAYERS : null;
  if (exactFeeOk === false) {
    seen.errors.push(`entry with exact fee: only ${seen.joinsOk}/${PLAYERS} joins succeeded`);
  }

  console.log('\n──────── SUMMARY ────────');
  console.log('finished       :', seen.finished);
  console.log('rounds played  :', seen.rounds);
  console.log('modes seen     :', JSON.stringify(seen.modes));
  if (exactFeeOk !== null) {
    console.log(
      'entry with exact fee:',
      exactFeeOk ? 'ok' : `FAILED (${seen.joinsOk}/${PLAYERS} joins)`,
    );
  }
  if (EXPECT_SET) {
    console.log(
      'set slots      :',
      setCheck ? `matched ${setCheck.matched}/${setCheck.compare}` : 'set not loaded',
    );
  }
  console.log('eliminated     :', seen.eliminated.size);
  console.log(
    'ticketsUpdated :',
    `${seen.ticketsUpdated} event(s) · ${seen.ticketsPlayers.size}/${players.length} players · ` +
      (Object.keys(seen.ticketsReasons).length ? JSON.stringify(seen.ticketsReasons) : 'no reasons'),
  );
  if (missingPush.length) console.log('  ⚠ no push for :', missingPush.join(', '));
  console.log('booking status :', seen.bookingProbes.length ? JSON.stringify(seen.bookingProbes) : 'never probed');
  console.log(
    'booking roster :',
    seen.bookingSelfIndices.length
      ? `our players at [${seen.bookingSelfIndices.join(', ')}] (must rise: registration order)`
      : 'no post-registration probe',
  );
  if (seen.rosterShapeIssues.length) {
    console.log('  ⚠ roster shape :', seen.rosterShapeIssues.slice(0, 6).join('; '));
  }
  console.log('connect roster :', JSON.stringify(seen.connectRosters));
  console.log('buyBackOffer   :', seen.offers.length ? JSON.stringify(seen.offers) : 'none');
  console.log('buyBack ok     :', seen.buyBackOk);
  console.log('buyBack denied :', seen.denials.length ? seen.denials.join(', ') : 'none');
  if (seen.otherEvents.size) console.log('ignored events :', [...seen.otherEvents].join(', '));
  console.log('errors         :', seen.errors.length ? seen.errors.join(', ') : 'none');

  for (const p of players) {
    try { p.survivalConnection?.close(); } catch {}
  }
  // `errors` counts too, or the regression guards above are decoration: the one that catches a
  // generic 'BuyBack denied' would print its complaint and still exit 0.
  const ok = seen.finished && seen.rounds > 0 && seen.ticketsUpdated > 0 && seen.errors.length === 0;
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('E2E FAILED:', err.message);
  process.exit(1);
});
