import os from 'os';
import path from 'path';
import fs from 'fs';
import createHttpError from 'http-errors';
import httpProxy from 'http-proxy';
import { logger } from '@jobscale/logger';

const { BACKEND, HEADERS } = process.env;
const backend = BACKEND;

const proxy = httpProxy.createProxyServer({ xfwd: true });

class App {
  useHeader(req, res) {
    const headers = new Headers(req.headers);
    const protocol = req.socket.encrypted ? 'https' : 'http';
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
    const headers = new Headers(req.headers);
    const { url } = req;
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const host = headers.get('host');
    const { pathname } = new URL(`${protocol}://${host}${url}`);
    const file = {
      path: path.join(process.cwd(), 'docs', pathname),
    };
    if (!fs.existsSync(file.path)) return false;
    const stats = fs.statSync(file.path);
    if (stats.isDirectory()) file.path += 'index.html';
    if (!fs.existsSync(file.path)) return false;
    const mime = filePath => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.png', '.jpeg', '.webp', '.gif'].includes(ext)) return `image/${ext}`;
      if (['.jpg'].includes(ext)) return 'image/jpeg';
      if (['.ico'].includes(ext)) return 'image/x-ico';
      if (['.json'].includes(ext)) return 'application/json';
      if (['.pdf'].includes(ext)) return 'application/pdf';
      if (['.zip'].includes(ext)) return 'application/zip';
      if (['.xml'].includes(ext)) return 'application/xml';
      if (['.html', '.svg'].includes(ext)) return 'text/html';
      if (['.js'].includes(ext)) return 'text/javascript';
      if (['.css'].includes(ext)) return 'text/css';
      if (['.txt', '.md'].includes(ext)) return 'text/plain';
      return 'application/octet-stream';
    };
    const stream = fs.createReadStream(file.path);
    res.writeHead(200, { 'Content-Type': mime(file.path) });
    stream.pipe(res);
    return true;
  }

  useLogging(req, res) {
    const ts = new Date().toISOString();
    const progress = () => {
      const headers = new Headers(req.headers);
      const remoteIp = headers.get('X-Forwarded-For') || req.socket.remoteAddress;
      const { method, url } = req;
      const protocol = req.socket.encrypted ? 'https' : 'http';
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

  pathAll(req, res, route, target, uri) {
    if (route.startsWith(`GET ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`POST ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`PUT ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`DELETE ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`PATCH ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`OPTIONS ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    if (route.startsWith(`HEAD ${uri}`)) {
      proxy.web(req, res, { target });
      return true;
    }
    return false;
  }

  router(req, res) {
    const headers = new Headers(req.headers);
    if (HEADERS) {
      const checks = Object.entries(JSON.parse(HEADERS));
      for (const check of checks) {
        const [key, value] = check;
        const auth = headers.get(key);
        if (!auth || !auth.startsWith(value)) {
          const e = createHttpError(403);
          res.writeHead(e.status, { 'Content-Type': 'text/plain' });
          res.end(e.message);
          return;
        }
      }
    }
    const method = req.method.toUpperCase();
    const { url } = req;
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const host = headers.get('host');
    const { pathname, searchParams } = new URL(`${protocol}://${host}${url}`);
    const route = `${method} ${pathname}`;
    logger.debug({ route, searchParams });

    if (this.pathAll(req, res, route, backend, '/')) return;

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

  upgradeHandler(req, socket, head) {
    const headers = new Headers(req.headers);
    const upgrade = headers.get('upgrade');
    logger.info({ url: req.url, upgrade });
    if (req.url.startsWith('/')) {
      proxy.ws(req, socket, head, { target: backend });
      return;
    }
    socket.destroy();
  }

  errorHandler(e, req, res) {
    logger.error(e);
    if (!res) return;
    if (!e.status) e = createHttpError(500);
    res.writeHead(e.status, { 'Content-Type': 'text/plain' });
    res.end(e.message);
  }

  start() {
    return (req, res) => {
      try {
        this.useHeader(req, res);
        if (this.usePublic(req, res)) return;
        this.useLogging(req, res);
        this.router(req, res);
      } catch (e) {
        this.errorHandler(e, req, res);
      }
    };
  }
}

const instance = new App();
instance.app = instance.start();
export const { app, upgradeHandler, errorHandler } = instance;
export default instance;
