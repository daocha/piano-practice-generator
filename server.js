#!/usr/bin/env node
// Zero-dependency static file server for local network use,
// as an alternative to `tailscale serve`.
//
// Usage:
//   node server.js                # http://<lan-ip>:6010
//   node server.js --port 3000    # custom port
//   node server.js --https        # https://<lan-ip>:6010 (self-signed cert)
//   node server.js --https --port 4443
//
// Port precedence: --port flag > $PORT env var > 6010 default.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const useHttps = args.includes('--https');
const portArgIndex = args.indexOf('--port');
const port = portArgIndex !== -1 && args[portArgIndex + 1]
  ? parseInt(args[portArgIndex + 1], 10)
  : parseInt(process.env.PORT, 10) || 6010;

const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(root)) return null; // block path traversal
  return target;
}

function requestHandler(req, res) {
  let filePath = safeJoin(ROOT, req.url === '/' ? '/index.html' : req.url);
  if (!filePath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-ish fallback for extensionless paths -> not needed here, just 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

function ensureCert() {
  const certDir = path.join(ROOT, 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  fs.mkdirSync(certDir, { recursive: true });
  console.log('Generating self-signed certificate (first run only)...');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '825',
      '-subj', '/CN=jianpu-generator.local',
    ], { stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to generate certificate. Is "openssl" installed?');
    process.exit(1);
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

const server = useHttps
  ? https.createServer(ensureCert(), requestHandler)
  : http.createServer(requestHandler);

server.listen(port, () => {
  const scheme = useHttps ? 'https' : 'http';
  const addrs = getLanAddresses();
  console.log(`\n簡譜產生器已啟動 (${scheme.toUpperCase()})\n`);
  console.log(`  本機:   ${scheme}://localhost:${port}`);
  addrs.forEach((a) => console.log(`  區網:   ${scheme}://${a}:${port}`));
  if (useHttps) {
    console.log('\n這是自簽憑證，第一次在 iPad Safari 開啟時會顯示「不受信任」警告，');
    console.log('請點擊「顯示詳細資料」→「瀏覽這個網站」即可繼續使用。');
  }
  console.log('\n按 Ctrl+C 停止伺服器\n');
});
