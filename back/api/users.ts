// back/api/users.ts
import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import RbacService from '../services/rbac';
const route = Router();

export default (app: Router) => {
  app.use('/users', route);

  route.get('/', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      const data = await Container.get(RbacService).listUsers();
      return res.send({ code: 200, data });
    } catch (e) { logger.error('🔥 error: %o', e); return next(e); }
  });

  route.post('/',
    celebrate({ body: Joi.object({
      username: Joi.string().min(2).required(),
      password: Joi.string().min(6).required(),
      nickname: Joi.string().allow('').optional(),
      email: Joi.string().allow('').optional(),
      roleIds: Joi.array().items(Joi.number()).required(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        const id = await Container.get(RbacService).createUser(req.body);
        return res.send({ code: 200, data: { id } });
      } catch (e: any) {
        logger.error('🔥 error: %o', e);
        return res.send({ code: 400, message: e.message });
      }
    });

  route.put('/:id',
    celebrate({ body: Joi.object({
      nickname: Joi.string().allow('').optional(),
      email: Joi.string().allow('').optional(),
      isActive: Joi.number().valid(0, 1).optional(),
      roleIds: Joi.array().items(Joi.number()).optional(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).updateUser(Number(req.params.id), req.body);
        return res.send({ code: 200 });
      } catch (e: any) {
        logger.error('🔥 error: %o', e);
        return res.send({ code: 400, message: e.message });
      }
    });

  route.put('/:id/password',
    celebrate({ body: Joi.object({ password: Joi.string().min(6).required() }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).resetPassword(Number(req.params.id), req.body.password);
        return res.send({ code: 200 });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.delete('/:id', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      await Container.get(RbacService).deleteUser(Number(req.params.id));
      return res.send({ code: 200 });
    } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
  });
};
