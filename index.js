import http from 'http';
import { logger } from '@jobscale/logger';
import { app, upgradeHandler, errorHandler } from './app/index.js';

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

const main = async () => {
  const server = http.createServer(app);
  server.on('upgrade', upgradeHandler);
  server.on('error', errorHandler);
  const options = {
    host: '0.0.0.0',
    port: PORT,
  };
  server.listen(options, () => {
    logger.info(JSON.stringify({
      Server: 'Started',
      'Listen on': `http://127.0.0.1:${options.port}`,
    }, null, 2));
  });
  return app;
};

export default main();
