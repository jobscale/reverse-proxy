const os = require('os');
const path = require('path');
const fs = require('fs');
const createHttpError = require('http-errors');
const httpProxy = require('http-proxy');
const { logger } = require('@jobscale/logger');

const proxy = httpProxy.createProxyServer({ xfwd: true });
const silent = () => undefined;

class App {
  useHeader(req, res) {
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const headers = new Headers(req.headers);
    const host = headers.get('host');
    const origin = headers.get('origin') || `${protocol}://${host}`;
    res.setHeader('ETag', 'false');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Server', 'acl-ingress-k8s');
    res.setHeader('X-Backend-Host', os.hostname());
  }

  usePublic(req, res) {
    const { url } = req;
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const headers = new Headers(req.headers);
    const host = headers.get('host');
    const { pathname } = new URL(`${protocol}://${host}${url}`);
    const filePath = path.join(process.cwd(), 'docs', pathname);
    try {
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(buf);
    } catch (e) {
      silent(e.message);
    }
  }

  useLogging(req, res) {
    const ts = new Date().toISOString();
    const progress = () => {
      const remoteIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const { method, url } = req;
      const protocol = req.socket.encrypted ? 'https' : 'http';
      const headers = new Headers(req.headers);
      const host = headers.get('host');
      logger.info({
        ts,
        req: JSON.stringify({
          remoteIp, protocol, host, method, url,
        }),
        headers: JSON.stringify(Object.fromEntries(headers.entries())),
      });
    };
    progress();
    res.on('finish', () => {
      const { statusCode, statusMessage } = res;
      const headers = JSON.stringify(res.getHeaders());
      logger.info({
        ts, statusCode, statusMessage, headers,
      });
    });
  }

  router(req, res) {
    const method = req.method.toLowerCase();
    const { url } = req;
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const headers = new Headers(req.headers);
    const host = headers.get('host');
    const auth = headers.get('authorization');
    if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=')) {
      const e = createHttpError(403);
      res.writeHead(e.status, { 'Content-Type': 'text/plain' });
      res.end(e.message);
      return;
    }
    const { pathname, searchParams } = new URL(`${protocol}://${host}${url}`);
    const route = `${method} ${pathname}`;
    silent({ route, searchParams });
    if (route.startsWith('get /')) {
      proxy.web(req, res, { target: 'http://lo-stack.x.jsx.jp:10456' });
      return;
    }
    if (route.startsWith('post /')) {
      proxy.web(req, res, { target: 'http://lo-stack.x.jsx.jp:10456' });
      return;
    }
    if (route.startsWith('put /')) {
      proxy.web(req, res, { target: 'http://lo-stack.x.jsx.jp:10456' });
      return;
    }
    if (route.startsWith('delete /')) {
      proxy.web(req, res, { target: 'http://lo-stack.x.jsx.jp:10456' });
      return;
    }
    this.notfoundHandler(req, res);
  }

  notfoundHandler(req, res) {
    if (req.method === 'GET') {
      const e = createHttpError(404);
      res.writeHead(e.status, { 'Content-Type': 'text/plain' });
      res.end(e.message);
      return;
    }
    const e = createHttpError(501);
    res.writeHead(e.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: e.message }));
  }

  start() {
    return (req, res) => {
      this.useHeader(req, res);
      this.usePublic(req, res);
      this.useLogging(req, res);
      this.router(req, res);
    };
  }
}

module.exports = {
  app: new App().start(),
};
