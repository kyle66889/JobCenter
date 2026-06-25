import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import UserService from '../services/user';
import RbacService from '../services/rbac';
import { UserModel } from '../data/user';
import { celebrate, Joi } from 'celebrate';
import multer from 'multer';
import path from 'path';
import { v4 as uuidV4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import config from '../config';
import { t } from '../shared/i18n';
import { isDemoEnv, getToken } from '../config/util';
const route = Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, config.uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.parse(file.originalname).ext;
    const key = uuidV4();
    cb(null, key + ext);
  },
});
const upload = multer({ storage: storage });

export default (app: Router) => {
  app.use('/user', route);

  route.post(
    '/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
    }),
    celebrate({
      body: Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.login({ ...req.body }, req);
        return res.send(data);
      } catch (e) {
        return next(e);
      }
    },
  );

  route.post(
    '/logout',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const token = getToken(req);
        await userService.logout(req.platform, token);
        res.send({ code: 200 });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/',
    celebrate({
      body: Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (isDemoEnv()) {
          return res.send({ code: 450, message: t('未知错误') });
        }
        // 自助改用户名/密码：只改本人 Users 表行，不再写全局共享 authInfo
        // （否则任一用户的修改会污染全局，且多用户下语义错误）
        const userId = (req as any).auth?.userId as number | undefined;
        if (!userId) {
          return res.send({ code: 401, message: t('未知错误') });
        }
        const { username, password } = req.body;
        if (password === 'admin') {
          return res.send({ code: 400, message: t('密码不能设置为admin') });
        }
        const rbac = Container.get(RbacService);
        if (username) {
          const existing = await UserModel.findOne({ where: { username } });
          if (existing && existing.id !== userId) {
            return res.send({ code: 400, message: t('用户已存在') });
          }
          await UserModel.update({ username }, { where: { id: userId } });
        }
        if (password) {
          await rbac.resetPassword(userId, password);
        }

        res.send({ code: 200, message: t('更新成功') });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/password',
    celebrate({
      body: Joi.object({
        oldPassword: Joi.string().required(),
        newPassword: Joi.string().min(6).required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userId = (req as any).auth?.userId as number;
        const rbac = Container.get(RbacService);
        const user = await rbac.findUserById(userId);
        const bcrypt = (await import('bcryptjs')).default;
        const ok =
          user && (await bcrypt.compare(req.body.oldPassword, user.passwordHash || ''));
        if (!ok) return res.send({ code: 400, message: '原密码不正确' });
        await rbac.resetPassword(userId, req.body.newPassword);
        return res.send({ code: 200 });
      } catch (e) {
        logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const logger: Logger = Container.get('logger');
    try {
      const userService = Container.get(UserService);
      const authInfo = await userService.getAuthInfo();
      const userId = (req as any).auth?.userId as number | undefined;
      const rbac = Container.get(RbacService);
      let isAdmin = false;
      let pages: string[] = [];
      // 身份按登录用户(req.auth.userId)取 Users 表，而非全局共享 authInfo（否则任何人都显示 admin）
      const u = userId ? await rbac.findUserById(userId) : null;
      if (userId) {
        isAdmin = await rbac.isAdmin(userId);
        pages = await rbac.effectivePages(userId);
      }
      res.send({
        code: 200,
        data: {
          username: u?.username || authInfo.username,
          nickname: u?.nickname || u?.username || authInfo.username,
          avatar: u?.avatar || authInfo.avatar,
          twoFactorActivated: u
            ? u.twoFactorActivated === 1
            : authInfo.twoFactorActivated,
          isAdmin,
          pages,
        },
      });
    } catch (e) {
      logger.error('🔥 error: %o', e);
      return next(e);
    }
  });

  route.get(
    '/two-factor/init',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.initTwoFactor();
        res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/two-factor/active',
    celebrate({
      body: Joi.object({
        code: Joi.string().required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.activeTwoFactor(req.body.code);
        res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/two-factor/deactivate',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.deactivateTwoFactor();
        res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/two-factor/login',
    celebrate({
      body: Joi.object({
        code: Joi.string().required(),
        username: Joi.string().required(),
        password: Joi.string().required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.twoFactorLogin(req.body, req);
        res.send(data);
      } catch (e) {
        return next(e);
      }
    },
  );

  route.get(
    '/login-log',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.getLoginLog();
        res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.get(
    '/notification',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const data = await userService.getNotificationMode();
        res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/notification',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const result = await userService.updateNotificationMode(req.body);
        res.send(result);
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/init',
    celebrate({
      body: Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        await userService.updateUsernameAndPassword(req.body);
        res.send({ code: 200, message: t('更新成功') });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/notification/init',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const userService = Container.get(UserService);
        const result = await userService.updateNotificationMode(req.body);
        res.send(result);
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/avatar',
    upload.single('avatar'),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const filename = req.file!.filename;
        const userId = (req as any).auth?.userId as number | undefined;
        // 头像按登录用户存入 Users 表行，而非全局共享 authInfo（否则全员共用一个头像）
        if (userId) {
          await UserModel.update({ avatar: filename }, { where: { id: userId } });
          return res.send({
            code: 200,
            data: filename,
            message: t('更新成功'),
          });
        }
        const userService = Container.get(UserService);
        const result = await userService.updateAvatar(filename);
        res.send(result);
      } catch (e) {
        return next(e);
      }
    },
  );
};
