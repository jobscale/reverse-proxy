import { jest } from '@jest/globals';

jest.unstable_mockModule('fs', () => ({
  default: {
    existsSync: jest.fn(),
    statSync: jest.fn(),
    createReadStream: jest.fn(),
  },
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
}));

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
const { default: appInstance, app } = await import('../app/index.js');

describe('Reverse Proxy App', () => {
  let req;
  let res;

  beforeEach(() => {
    req = {
      headers: {},
      socket: { encrypted: false, remoteAddress: '127.0.0.1' },
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
    jest.clearAllMocks();
  });

  it('app should be a function', () => {
    expect(typeof app).toBe('function');
  });

  describe('useHeader', () => {
    it('should set security and CORS headers', () => {
      appInstance.useHeader(req, res);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', 'false');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.any(String));
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, HEAD');
      expect(res.setHeader).toHaveBeenCalledWith('Server', 'acl-ingress-k8s');
    });
  });

  describe('usePublic', () => {
    it('should serve static file if exists', () => {
      const mockStat = { isDirectory: () => false };
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue(mockStat);
      fs.createReadStream.mockReturnValue({
        pipe: jest.fn(),
      });

      req.url = '/.gitignore';
      const result = appInstance.usePublic(req, res);

      expect(result).toBe(false);
    });

    it('should serve static file if not exists', () => {
      const mockStat = { isDirectory: () => false };
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue(mockStat);
      fs.createReadStream.mockReturnValue({
        pipe: jest.fn(),
      });

      req.url = '/test.html';
      const result = appInstance.usePublic(req, res);

      expect(result).toBe(false);
    });

    it('should return false if file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      req.url = '/nonexistent.html';
      const result = appInstance.usePublic(req, res);
      expect(result).toBe(false);
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
});
