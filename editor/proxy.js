'use strict';

// One origin for the questions editor.
//
// The session cookie is issued as `Path=/api` (hardcoded in questions-api's login
// controller), so the browser only sends it back to requests under /api on the same
// origin. In production nginx provides exactly that shape; locally this proxy does:
//
//   http://localhost:5174/api/*  ->  questions-api   :3001  (prefix stripped)
//   http://localhost:5174/*      ->  webpack-dev-server :8080 (UI + hot reload)

const http = require('http');
const net = require('net');

const PORT = parseInt(process.env.EDITOR_PROXY_PORT || '5174', 10);
const API = { host: '127.0.0.1', port: parseInt(process.env.QUESTIONS_API_PORT || '3001', 10) };
const UI = { host: '127.0.0.1', port: parseInt(process.env.EDITOR_UI_PORT || '8080', 10) };

/**
 * questions-api issues its session as `SameSite=None; Secure`, which is correct behind
 * the production HTTPS host but is dropped by browsers over plain http://localhost —
 * the login call succeeds and the session silently never sticks. Since the UI and the
 * API share this origin, `SameSite=Lax` without `Secure` is the local equivalent.
 */
function localCookies(headers) {
  const cookies = headers['set-cookie'];
  if (!cookies) return headers;

  return {
    ...headers,
    'set-cookie': cookies.map((cookie) =>
      cookie
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.toLowerCase() !== 'secure' && !/^samesite=/i.test(part))
        .concat('SameSite=Lax')
        .join('; '),
    ),
  };
}

const server = http.createServer((req, res) => {
  const toApi = req.url === '/api' || req.url.startsWith('/api/');
  const target = toApi ? API : UI;
  const path = toApi ? req.url.replace(/^\/api/, '') || '/' : req.url;

  const proxied = http.request(
    { host: target.host, port: target.port, method: req.method, path, headers: req.headers },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, localCookies(upstream.headers));
      upstream.pipe(res);
    },
  );

  proxied.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${toApi ? 'questions-api' : 'editor UI'} недоступний: ${err.message}`);
  });

  req.pipe(proxied);
});

// webpack-dev-server pushes hot updates over a websocket, so upgrades must pass through
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(UI.port, UI.host, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('') +
        '\r\n',
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
});

server.listen(PORT, () => {
  console.log(`[editor-proxy] http://localhost:${PORT}`);
  console.log(`[editor-proxy]   /api/*  -> ${API.host}:${API.port}`);
  console.log(`[editor-proxy]   /*      -> ${UI.host}:${UI.port}`);
});
