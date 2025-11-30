import { jest } from '@jest/globals';

// Set up environment variables before importing the app
process.env.BACKEND = 'http://backend';
process.env.HEADERS = JSON.stringify({ 'X-Auth': 'secret' });

jest.unstable_mockModule('fs', () => {
  const existsSync = jest.fn();
  const statSync = jest.fn();
  const createReadStream = jest.fn();
  return {
    default: {
      existsSync,
      statSync,
      createReadStream,
    },
    existsSync,
    statSync,
    createReadStream,
  };
});

jest.unstable_mockModule('http-proxy', () => ({
  default: {
    createProxyServer: jest.fn().mockReturnValue({
      web: jest.fn(),
      ws: jest.fn(),
    }),
  },
}));

jest.unstable_mockModule('@jobscale/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const fs = await import('fs');
const httpProxy = await import('http-proxy');
const { logger } = await import('@jobscale/logger');
const { default: appInstance, app, upgradeHandler, errorHandler } = await import('../app/index.js');

describe('Reverse Proxy App', () => {
  let req;
  let res;
  let proxy;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      headers: {
        host: 'localhost',
        'x-auth': 'secret',
      },
      socket: {
        encrypted: false,
        remoteAddress: '127.0.0.1',
        destroy: jest.fn(),
      },
      url: '/',
      method: 'GET',
    };
    res = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({}),
    };
    proxy = httpProxy.default.createProxyServer();
  });

  it('app should be a function', () => {
    expect(typeof app).toBe('function');
  });

  describe('useHeader', () => {
    it('should set security and CORS headers', () => {
      appInstance.useHeader(req, res);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', 'false');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, HEAD');
      expect(res.setHeader).toHaveBeenCalledWith('Server', 'acl-ingress-k8s');
    });

    it('should use https protocol if socket is encrypted', () => {
      req.socket.encrypted = true;
      appInstance.useHeader(req, res);
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://localhost');
    });
  });

  describe('usePublic', () => {
    it('should serve static file if exists', () => {
      const mockStat = { isDirectory: () => false };
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue(mockStat);
      const mockStream = { pipe: jest.fn() };
      fs.createReadStream.mockReturnValue(mockStream);

      req.url = '/test.html';
      const result = appInstance.usePublic(req, res);

      expect(result).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
      expect(mockStream.pipe).toHaveBeenCalledWith(res);
    });

    it('should serve index.html for directory', () => {
      const mockStat = { isDirectory: () => true };
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue(mockStat);
      const mockStream = { pipe: jest.fn() };
      fs.createReadStream.mockReturnValue(mockStream);

      req.url = '/';
      const result = appInstance.usePublic(req, res);

      expect(result).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
    });

    it('should return false if file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      req.url = '/nonexistent.html';
      const result = appInstance.usePublic(req, res);
      expect(result).toBe(false);
    });

    it('should return correct mime types', () => {
      const testMime = (ext, expectedType) => {
        const mockStat = { isDirectory: () => false };
        fs.existsSync.mockReturnValue(true);
        fs.statSync.mockReturnValue(mockStat);
        fs.createReadStream.mockReturnValue({ pipe: jest.fn() });

        req.url = `/test${ext}`;
        appInstance.usePublic(req, res);
        expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': expectedType });
      };

      testMime('.png', 'image/png');
      testMime('.jpg', 'image/jpeg');
      testMime('.json', 'application/json');
      testMime('.js', 'text/javascript');
      testMime('.css', 'text/css');
      testMime('.unknown', 'application/octet-stream');
    });
  });

  describe('useLogging', () => {
    it('should log request details', () => {
      appInstance.useLogging(req, res);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
        req: expect.stringContaining('"url":"/"'),
      }));
    });

    it('should log response details on finish', () => {
      appInstance.useLogging(req, res);
      const finishCallback = res.on.mock.calls.find(call => call[0] === 'finish')[1];

      res.statusCode = 200;
      res.statusMessage = 'OK';
      finishCallback();

      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 200,
        statusMessage: 'OK',
      }));
    });
  });

  describe('router', () => {
    it('should return 403 if auth header is missing or invalid', () => {
      req.headers['x-auth'] = 'wrong';
      appInstance.router(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
      expect(res.end).toHaveBeenCalled();
    });

    it('should proxy request if auth is valid', () => {
      appInstance.router(req, res);
      expect(proxy.web).toHaveBeenCalledWith(req, res, { target: 'http://backend' });
    });

    it('should handle different HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
      methods.forEach(method => {
        req.method = method;
        appInstance.router(req, res);
        expect(proxy.web).toHaveBeenCalled();
        jest.clearAllMocks();
      });
    });

    it('should call notfoundHandler for unknown routes/methods', () => {
      // This is tricky because pathAll covers all standard methods for '/'.
      // To trigger notfoundHandler, we might need a method not in pathAll or pathAll returning false.
      // But pathAll covers all methods for any URI starting with /.
      // Let's force pathAll to return false by mocking it or using a weird method if pathAll checks it?
      // pathAll checks specific methods. Let's try a method not in the list, e.g., TRACE.
      req.method = 'TRACE';
      appInstance.router(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(501, expect.anything());
    });
  });

  describe('notfoundHandler', () => {
    it('should return 404 for GET request', () => {
      req.method = 'GET';
      appInstance.notfoundHandler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
      expect(res.end).toHaveBeenCalled();
    });

    it('should return 501 for non-GET request', () => {
      req.method = 'POST';
      appInstance.notfoundHandler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(501, expect.anything());
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('upgradeHandler', () => {
    it('should proxy websocket upgrade', () => {
      const socket = { destroy: jest.fn() };
      const head = Buffer.from('');
      req.headers.upgrade = 'websocket';

      upgradeHandler(req, socket, head);
      expect(proxy.ws).toHaveBeenCalledWith(req, socket, head, { target: 'http://backend' });
    });

    it('should destroy socket if url does not start with /', () => {
      const socket = { destroy: jest.fn() };
      const head = Buffer.from('');
      req.url = 'invalid';

      upgradeHandler(req, socket, head);
      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe('errorHandler', () => {
    it('should log error and return 500 for generic error', () => {
      const error = new Error('Something went wrong');
      errorHandler(error, req, res);
      expect(logger.error).toHaveBeenCalledWith(error);
      expect(res.writeHead).toHaveBeenCalledWith(500, expect.anything());
      expect(res.end).toHaveBeenCalledWith('Internal Server Error');
    });

    it('should return specific status code if present in error', () => {
      const error = new Error('Not Found');
      error.status = 404;
      errorHandler(error, req, res);
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
    });

    it('should not crash if res is undefined', () => {
      const error = new Error('Error');
      expect(() => errorHandler(error, req, undefined)).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(error);
    });
  });

  describe('start', () => {
    it('should execute middleware chain', () => {
      const handler = appInstance.start();

      // Mock internal methods to verify order/execution
      jest.spyOn(appInstance, 'useHeader');
      jest.spyOn(appInstance, 'usePublic').mockReturnValue(false);
      jest.spyOn(appInstance, 'useLogging');
      jest.spyOn(appInstance, 'router');

      handler(req, res);

      expect(appInstance.useHeader).toHaveBeenCalled();
      expect(appInstance.usePublic).toHaveBeenCalled();
      expect(appInstance.useLogging).toHaveBeenCalled();
      expect(appInstance.router).toHaveBeenCalled();
    });

    it('should stop if usePublic returns true', () => {
      const handler = appInstance.start();

      jest.spyOn(appInstance, 'usePublic').mockReturnValue(true);
      jest.spyOn(appInstance, 'router');

      handler(req, res);

      expect(appInstance.usePublic).toHaveBeenCalled();
      expect(appInstance.router).not.toHaveBeenCalled();
    });

    it('should handle errors during execution', () => {
      const handler = appInstance.start();
      const error = new Error('Middleware error');

      jest.spyOn(appInstance, 'useHeader').mockImplementation(() => { throw error; });
      jest.spyOn(appInstance, 'errorHandler');

      handler(req, res);

      expect(appInstance.errorHandler).toHaveBeenCalledWith(error, req, res);
    });
  });
});
