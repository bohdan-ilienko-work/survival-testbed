'use strict';

// Survival testbed gateway.
//
// The browser cannot speak JSTP (raw TCP + JSTP record serialization), so this
// process does it: real JSTP connections to main-server and survival-server on one
// side, plain JSON over WebSocket to the React app on the other.
//
// EVERY BROWSER TAB IS AN INDEPENDENT PLAYER. Each WebSocket gets its own mock
// account and its own set of JSTP connections, because identity lives on the
// connection: main-server binds `connection.player` on signIn and survival-server
// binds the socket to a playerId in `survival.connect`. Sharing one upstream
// connection between tabs would make them the same player.
//
// Browser -> gateway:
//   { id, type: 'connect',  target }
//   { id, type: 'call',     target, iface, method, args }
//   { id, type: 'mockUser', account }   // account = {accountId, deviceId} to reuse, or null for a fresh player
//   { id, type: 'grantTickets', amount }
//   { id, type: 'mockClan', name }      // put this tab's player in a clan; name is only used by the call that creates it
//   { id, type: 'state' }
// gateway -> browser:
//   { id, type: 'result', ok, data | error }
//   { type: 'event',  target, iface, name, args }
//   { type: 'status', target, state, info }

const path = require('path');
const jstp = require('metarhia-jstp');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.GATEWAY_PORT || '8787', 10);
const MAIN_SERVER_GRPC = process.env.MAIN_SERVER_GRPC || '127.0.0.1:5012';

const TARGETS = {
  main: {
    app: 'beGenius',
    protocol: process.env.MAIN_SERVER_PROTOCOL || 'net',
    host: process.env.MAIN_SERVER_HOST || '127.0.0.1',
    port: parseInt(process.env.MAIN_SERVER_PORT || '7000', 10),
    // adminApi is a TESTBED-ONLY convenience. main-server exposes it unguarded (no
    // auth, no level, no payment checks — see applications/beGenius/api/adminApi/), and
    // it is the only way to hand a freshly signed-up mock account a clan while keeping
    // main-server's in-memory clan registry in sync. See mockClan() below.
    interfaces: ['beG', 'auth', 'adminApi'],
  },
  survival: {
    app: 'survival',
    protocol: 'net',
    host: process.env.SURVIVAL_SERVER_HOST || '127.0.0.1',
    port: parseInt(process.env.SURVIVAL_SERVER_PORT || '4001', 10),
    interfaces: ['survival'],
  },
};

const DEVICE_MODEL = 'SurvivalTestbed';

// ─── per-tab client ───────────────────────────────────────────────────────────

let nextTabId = 1;

/** One browser tab: its own player and its own upstream JSTP connections. */
class Client {
  constructor(ws) {
    this.ws = ws;
    this.tabId = nextTabId++;
    this.session = null; // { accountId, deviceId, playerId }
    this.connections = new Map(); // target -> { connection, api, alive }
  }

  send(msg) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  log(...parts) {
    const line = parts.map(String).join(' ');
    console.log(`[gateway#${this.tabId}]`, line);
    this.send({ type: 'log', line, at: Date.now() });
  }

  connectTarget(target) {
    const cfg = TARGETS[target];
    if (!cfg) return Promise.reject(new Error(`Unknown target ${target}`));

    const existing = this.connections.get(target);
    if (existing && existing.alive) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${target}: connect timeout (${cfg.host}:${cfg.port})`)),
        10000,
      );

      jstp[cfg.protocol].connectAndInspect(
        cfg.app,
        null,
        cfg.interfaces,
        cfg.port,
        cfg.host,
        (error, connection, api) => {
          clearTimeout(timer);
          if (error) {
            this.send({ type: 'status', target, state: 'error', info: String(error) });
            reject(error);
            return;
          }

          const entry = { connection, api, alive: true };

          connection.on('event', (iface, name, args) => {
            this.send({ type: 'event', target, iface, name, args });
          });
          connection.on('close', () => {
            entry.alive = false;
            this.connections.delete(target);
            this.send({ type: 'status', target, state: 'disconnected' });
          });
          connection.on('error', (err) => {
            this.send({ type: 'status', target, state: 'error', info: String(err) });
          });

          this.connections.set(target, entry);
          this.send({ type: 'status', target, state: 'connected', info: `${cfg.host}:${cfg.port}` });
          resolve(entry);
        },
      );
    });
  }

  call(target, iface, method, args = []) {
    return new Promise((resolve, reject) => {
      const entry = this.connections.get(target);
      if (!entry) return reject(new Error(`${target}: not connected`));

      const ifaceApi = entry.api[iface];
      if (!ifaceApi || typeof ifaceApi[method] !== 'function') {
        return reject(new Error(`${target}: no method ${iface}.${method}`));
      }

      // Calling convention differs per server: main-server's impress api files take
      // positional parameters, while survival's handlers are
      // `(connection, args, callback)` and expect ONE argument that is the array.
      const callArgs = target === 'main' ? args : [args];

      const timer = setTimeout(() => reject(new Error(`${target}.${method}: timeout`)), 15000);
      ifaceApi[method](...callArgs, (err, ...rest) => {
        clearTimeout(timer);
        if (err) return reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));

        // jstp wraps results as { res: [value] }; application errors arrive as a
        // successful callback carrying { error: { code, description } }.
        const raw = rest.length <= 1 ? rest[0] : rest;
        const value = raw && Array.isArray(raw.res) ? (raw.res.length <= 1 ? raw.res[0] : raw.res) : raw;
        if (value && value.error) {
          return reject(new Error(value.error.description || JSON.stringify(value.error)));
        }
        resolve(value);
      });
    });
  }

  destroy() {
    for (const entry of this.connections.values()) {
      try {
        entry.connection.close();
      } catch {
        // already gone
      }
    }
    this.connections.clear();
  }
}

// ─── mock user ────────────────────────────────────────────────────────────────

function playerIdFromToken(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8')).playerId;
  } catch {
    return undefined;
  }
}

/**
 * Sign a tab in. `reuse` is the {accountId, deviceId} the tab kept in its own
 * sessionStorage, so a page reload stays the same player while a NEW tab (which
 * has no stored account) always gets a brand new one.
 */
async function ensureMockUser(client, reuse) {
  await client.connectTarget('main');

  let accountId = reuse && reuse.accountId;
  let deviceId = reuse && reuse.deviceId;

  if (!accountId) {
    const created = await client.call('main', 'auth', 'signUp', [
      {
        language: 'en',
        character: client.tabId % 5,
        categories: ['history', 'geography', 'sport'],
        isTrial: false,
      },
    ]);
    accountId = String((created && (created.accountId || created.id)) || created);
    deviceId = `testbed-tab${client.tabId}-${Math.random().toString(16).slice(2, 8)}`;
    client.log('created account', accountId);
  }

  const signInRes = await client.call('main', 'auth', 'signIn', [
    accountId,
    deviceId,
    DEVICE_MODEL,
    {},
  ]);

  const playerId = playerIdFromToken(signInRes && signInRes.token);
  client.session = { accountId, deviceId, playerId, tabId: client.tabId };
  client.log('signed in as', playerId);
  return client.session;
}

// Testbed convenience: fresh accounts have no tickets. Top up through the real
// MainServerAPI.GrantTickets gRPC so main-server's player cache and moneyFlow stay
// consistent (a direct mongo write would be invisible to the cached player).
function grantTickets(playerId, amount) {
  const grpc = require('@grpc/grpc-js');
  const protoLoader = require('@grpc/proto-loader');
  const protoPath = path.join(__dirname, '..', '..', 'battleofgeniuses', 'proto', 'survival_server.proto');
  const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(protoPath)).survival_api;
  const client = new pkg.MainServerAPI(MAIN_SERVER_GRPC, grpc.credentials.createInsecure());

  return new Promise((resolve, reject) => {
    client.grantTickets(
      { json: JSON.stringify({ playerId, amount, reason: 'testbed' }) },
      (err, res) => {
        if (err) return reject(err);
        const payload = JSON.parse((res && (res.result || res.error)) || '{}');
        payload.error ? reject(new Error(payload.error)) : resolve(payload);
      },
    );
  });
}

// ─── mock clan ────────────────────────────────────────────────────────────────

// Same shape of problem as grantTickets above, same rule: fresh testbed accounts have
// no clan, so every row of the survival booking roster would render an empty clan name.
// main-server keeps clans in an IN-MEMORY registry (playerId_to_clan / clanId_to_clan in
// lib/clans.js) and RegisterPlayer resolves the name through api.beGenius.clans.getClan(),
// so a raw mongo write would be completely invisible to the running process. Everything
// therefore goes through main-server's unguarded `adminApi.clanAdmin`, which mutates that
// registry (and refreshes the online member's client context) exactly like a real join.

// fieldValidators.name in main-server's lib/clans.js is `trimmed, 1..20 characters`, and
// adminCreateClan rejects the WHOLE create with an opaque "Invalid clan fields: name".
// Keep the default comfortably inside the limit and clamp anything the UI supplies.
const CLAN_NAME_MAX = 20;
const DEFAULT_CLAN_NAME = 'Testbed Clan';

// ONE clan per gateway PROCESS, not per tab. The whole point of the mock is a roster in
// which several rows share a clan name, and every tab is a different player on its own
// upstream connection — so the first tab to ask creates the clan and every later tab is
// added to that same one with created:false. A supplied name is consequently only honoured
// by the call that actually creates the clan; ignoring it afterwards is deliberate, because
// a second tab asking for a different name must still end up in the FIRST tab's clan.
let lastCreatedClan = null; // { clanId, name }

function normalizeClanName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const clamped = (trimmed || DEFAULT_CLAN_NAME).slice(0, CLAN_NAME_MAX).trim();
  return clamped || DEFAULT_CLAN_NAME;
}

// The admin clan handlers reject with plain Errors whose TEXT carries the clan id
// ("Player already in clan 12345678 — detach first"). Depending on the hop that text
// arrives either as a RemoteError message or as a JSON blob (see Client.call, which
// JSON.stringify()s non-string errors), so match on the string rather than on any
// structured field — there is no structured field to match on.
const clanErrorText = (err) => String((err && err.message) || err || '');
const existingClanIdFromError = (err) => {
  const m = /already in clan\s+([0-9A-Za-z]+)/.exec(clanErrorText(err));
  return m ? m[1] : null;
};
const isAlreadyThisClanError = (err) => /already in this clan/i.test(clanErrorText(err));
const isMissingClanError = (err) => /clan not found/i.test(clanErrorText(err));

// `get` answers { clan: {...} | null } — null for an unknown or disbanded id. Guard the
// shape instead of trusting it, and never fail mockClan over a missing name: the roster
// gets its clan names from beG.getSurvivalStatus, this one is only for the log/toast.
async function readClanName(client, clanId) {
  try {
    const res = await client.call('main', 'adminApi', 'clanAdmin', [{ action: 'get', clanId }]);
    const clan = res && res.clan;
    return clan && typeof clan.name === 'string' ? clan.name : '';
  } catch {
    return '';
  }
}

async function mockClan(client, requestedName) {
  if (!client.session || !client.session.playerId) throw new Error('sign in first');
  const playerId = client.session.playerId;
  const name = normalizeClanName(requestedName);

  if (lastCreatedClan) {
    try {
      await client.call('main', 'adminApi', 'clanAdmin', [
        { action: 'addMember', clanId: lastCreatedClan.clanId, playerId },
      ]);
      client.log('joined clan', lastCreatedClan.clanId, `(${lastCreatedClan.name})`);
      return { ...lastCreatedClan, created: false };
    } catch (err) {
      // Idempotent: re-asking after the tab already joined is a success, not an error.
      if (isAlreadyThisClanError(err)) return { ...lastCreatedClan, created: false };

      // The player belongs to some OTHER clan (a reloaded tab whose account was created
      // before the gateway restarted). Report that clan; do not touch lastCreatedClan,
      // which is still perfectly valid for the tabs that are not in a clan yet.
      const otherId = existingClanIdFromError(err);
      if (otherId) {
        const otherName = await readClanName(client, otherId);
        client.log('already in clan', otherId, `(${otherName})`);
        return { clanId: otherId, name: otherName, created: false };
      }

      // main-server was restarted (or the clan was disbanded) under us, so the remembered
      // id no longer resolves. Forget it and fall through to creating a fresh one.
      if (!isMissingClanError(err)) throw err;
      client.log('remembered clan', lastCreatedClan.clanId, 'is gone, creating a new one');
      lastCreatedClan = null;
    }
  }

  try {
    // description is left out on purpose: adminCreateClan defaults it to the name, which
    // always satisfies its own 1..300 validator once the name above is valid.
    const res = await client.call('main', 'adminApi', 'clanAdmin', [
      { action: 'create', leaderPlayerId: playerId, params: { name } },
    ]);

    // adminCreateClan answers { clan: { id, name, ... } }; tolerate a flat clanId too
    // rather than reading res.clan.id blind.
    const clan = (res && res.clan) || null;
    const clanId = String((res && res.clanId) || (clan && clan.id) || '');
    if (!clanId) throw new Error('clanAdmin.create returned no clan id');

    // main-server escapes rich-text tags in the name, so echo back what it stored.
    lastCreatedClan = {
      clanId,
      name: (clan && typeof clan.name === 'string' && clan.name) || name,
    };
    client.log('created clan', clanId, `(${lastCreatedClan.name})`);
    return { ...lastCreatedClan, created: true };
  } catch (err) {
    // adminCreateClan refuses outright for a player who already has a clan. That is the
    // normal case for a tab whose account outlived this process, so turn it into a
    // created:false answer and adopt the clan, so later tabs join it instead of piling up
    // one clan per tab.
    const existingId = existingClanIdFromError(err);
    if (!existingId) throw err;
    const existingName = await readClanName(client, existingId);
    if (!lastCreatedClan) lastCreatedClan = { clanId: existingId, name: existingName };
    client.log('already in clan', existingId, `(${existingName})`);
    return { clanId: existingId, name: existingName, created: false };
  }
}

// ─── websocket API for the browser ────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  const client = new Client(ws);
  console.log(`[gateway] tab #${client.tabId} connected`);

  client.send({
    type: 'hello',
    tabId: client.tabId,
    targets: Object.fromEntries(
      Object.entries(TARGETS).map(([k, v]) => [k, `${v.protocol}://${v.host}:${v.port}`]),
    ),
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const reply = (ok, payload) =>
      client.send(
        ok
          ? { id: msg.id, type: 'result', ok: true, data: payload }
          : {
              id: msg.id,
              type: 'result',
              ok: false,
              error: String(payload && payload.message ? payload.message : payload),
            },
      );

    try {
      switch (msg.type) {
        case 'connect':
          await client.connectTarget(msg.target);
          reply(true, { target: msg.target });
          break;
        case 'call':
          reply(true, await client.call(msg.target, msg.iface, msg.method, msg.args || []));
          break;
        case 'mockUser':
          reply(true, await ensureMockUser(client, msg.account));
          break;
        case 'grantTickets': {
          if (!client.session || !client.session.playerId) throw new Error('sign in first');
          reply(true, await grantTickets(client.session.playerId, msg.amount || 50));
          break;
        }
        case 'mockClan':
          reply(true, await mockClan(client, msg.name));
          break;
        case 'state':
          reply(true, { session: client.session, connected: [...client.connections.keys()] });
          break;
        default:
          reply(false, `unknown message type ${msg.type}`);
      }
    } catch (err) {
      reply(false, err);
    }
  });

  ws.on('close', () => {
    console.log(`[gateway] tab #${client.tabId} disconnected`);
    client.destroy();
  });
});

console.log(`[gateway] listening on ws://localhost:${PORT} — one player per browser tab`);
