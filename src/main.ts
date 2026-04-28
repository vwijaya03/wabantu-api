import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/utils/validation-exception.factory';
import type {
  AppConfig,
  DatabaseConfig,
  RedisConfig,
} from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Disable Nest's built-in body parser so we register JSON/urlencoded
    // exactly once here (avoids double-parse if Nest adds defaults later).
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  app.set('trust proxy', appCfg.trustProxy);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: appCfg.corsOrigins.length ? appCfg.corsOrigins : true,
    credentials: true,
  });

  app.setGlobalPrefix(appCfg.apiPrefix, {
    exclude: [
      { path: 'health', method: 0 },
      { path: 'health/ready', method: 0 },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appCfg.apiVersion,
    prefix: 'v',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableShutdownHooks();

  await app.listen(appCfg.port);

  // Print a resolved-config banner so a developer can immediately spot
  // when shell env has hijacked DB/Redis hosts (a common foot-gun on
  // machines that also work on other projects with overlapping var names).
  const dbCfg = config.getOrThrow<DatabaseConfig>('database');
  const redisCfg = config.getOrThrow<RedisConfig>('redis');
  const banner = [
    '',
    '┌─ WABantu API ─────────────────────────────────────────────',
    `│ env       : ${appCfg.env}`,
    `│ listening : http://localhost:${appCfg.port}/${appCfg.apiPrefix}/v${appCfg.apiVersion}`,
    `│ system DB : ${dbCfg.system.host}:${dbCfg.system.port}/${dbCfg.system.database} (${dbCfg.system.username})`,
    `│ tenant DB : ${dbCfg.tenant.host}:${dbCfg.tenant.port}/${dbCfg.tenant.database} (${dbCfg.tenant.username})`,
    `│ redis     : ${redisCfg.host}:${redisCfg.port} db=${redisCfg.db}${redisCfg.password ? ' (auth)' : ''}`,
    '└───────────────────────────────────────────────────────────',
    '',
  ].join('\n');

  console.log(banner);
}

void bootstrap();
