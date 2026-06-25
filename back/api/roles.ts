// back/api/roles.ts
import { Joi, celebrate } from 'celebrate';
import { Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import RbacService from '../services/rbac';
import { PAGE_KEYS } from '../shared/pageKeys';
const route = Router();

export default (app: Router) => {
  app.use('/roles', route);

  route.get('/', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      const data = await Container.get(RbacService).listRoles();
      return res.send({ code: 200, data, allPageKeys: PAGE_KEYS });
    } catch (e) { logger.error('🔥 error: %o', e); return next(e); }
  });

  route.post('/',
    celebrate({ body: Joi.object({
      name: Joi.string().min(2).required(),
      description: Joi.string().allow('').optional(),
      pageKeys: Joi.array().items(Joi.string()).required(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        const id = await Container.get(RbacService).createRole(req.body);
        return res.send({ code: 200, data: { id } });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.put('/:id',
    celebrate({ body: Joi.object({
      name: Joi.string().min(2).optional(),
      description: Joi.string().allow('').optional(),
      pageKeys: Joi.array().items(Joi.string()).optional(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).updateRole(Number(req.params.id), req.body);
        return res.send({ code: 200 });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.delete('/:id', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      await Container.get(RbacService).deleteRole(Number(req.params.id));
      return res.send({ code: 200 });
    } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
  });
};
