import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import FbdService from '../services/fbd';
import RbacService from '../services/rbac';

const route = Router();

async function currentUsername(req: Request): Promise<string> {
  const userId = (req as any).auth?.userId as number | undefined;
  if (!userId) return 'unknown';
  const rbac = Container.get(RbacService);
  const user = await rbac.findUserById(userId);
  return user?.username || 'unknown';
}

export default (app: Router) => {
  app.use('/fbd', route);

  route.get(
    '/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.list({
          searchValue: req.query.searchValue as string,
          status:
            req.query.status !== undefined && req.query.status !== ''
              ? Number(req.query.status)
              : undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          size: req.query.size ? Number(req.query.size) : undefined,
        });
        return res.send({ code: 200, data });
      } catch (e) {
        logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.get(
    '/tasks/:id',
    celebrate({ params: Joi.object({ id: Joi.number().required() }) }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.get(Number(req.params.id));
        return res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.post(
    '/tasks',
    celebrate({
      body: Joi.object({
        title: Joi.string().required(),
        type: Joi.string().required(),
        source: Joi.string().optional().allow(''),
        payload: Joi.any().optional(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.create(req.body);
        return res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/tasks/:id/approve',
    celebrate({ params: Joi.object({ id: Joi.number().required() }) }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const operator = await currentUsername(req);
        const data = await fbdService.approve(Number(req.params.id), operator);
        return res.send({ code: 200, data });
      } catch (e: any) {
        return res.send({ code: 400, message: e?.message || String(e) });
      }
    },
  );

  route.put(
    '/tasks/:id/reject',
    celebrate({ params: Joi.object({ id: Joi.number().required() }) }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const operator = await currentUsername(req);
        const data = await fbdService.reject(Number(req.params.id), operator);
        return res.send({ code: 200, data });
      } catch (e: any) {
        return res.send({ code: 400, message: e?.message || String(e) });
      }
    },
  );

  route.delete(
    '/tasks',
    celebrate({ body: Joi.array().items(Joi.number().required()) }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        await fbdService.remove(req.body);
        return res.send({ code: 200 });
      } catch (e) {
        return next(e);
      }
    },
  );
};
