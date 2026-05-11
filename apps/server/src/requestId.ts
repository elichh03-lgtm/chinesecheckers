import type { RequestHandler } from 'express';
import { nanoid } from 'nanoid';
import { logger } from './lib/logger.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : nanoid(12);
  res.locals.requestId = id;
  res.locals.logger = logger.child({ requestId: id, method: req.method, path: req.path });
  res.setHeader('x-request-id', id);
  next();
};
