/**
 * Strongly-typed configuration loader.
 * Read once at boot, then accessed via `ConfigService.get<AppConfig>('xxx')`.
 *
 * Why a single typed loader instead of reading process.env everywhere?
 * - Single source of truth for env -> domain shape mapping.
 * - Easier to mock in tests.
 * - Validated by Joi schema in env.validation.ts before this runs.
 */

export interface AppConfig {
  env: 'development' | 'test' | 'staging' | 'production';
  name: string;
  port: number;
  url: string;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[];
  trustProxy: number;
}

export interface LogConfig {
  level: string;
  format: 'pretty' | 'json';
}

export interface DatabaseConnConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
  synchronize: boolean;
  logging: boolean;
}

export interface DatabaseConfig {
  system: DatabaseConnConfig;
  tenant: DatabaseConnConfig & { schemaPrefix: string };
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  bullmqDb: number;
}

export interface AuthConfig {
  jwtAccessSecret: string;
  jwtAccessTtl: string;
  jwtRefreshSecret: string;
  jwtRefreshTtl: string;
  sessionTtl: string;
  passwordHashRounds: number;
}

export interface ThrottleConfig {
  ttl: number;
  limit: number;
}

export interface WhatsAppConfig {
  provider: 'meta_cloud' | 'baileys';
  metaGraphApiVersion: string;
  metaAppId: string;
  metaWebhookVerifyToken: string;
  metaAppSecret: string;
}

export interface AiConfig {
  anthropicApiKey: string;
  anthropicModel: string;
  anthropicMaxTokens: number;
}

export interface StorageConfig {
  driver: 'local' | 's3';
  localDir: string;
  s3?: {
    endpoint?: string;
    region?: string;
    bucket?: string;
    accessKey?: string;
    secretKey?: string;
  };
}

export interface SecurityConfig {
  /** Master key for column-level encryption (email/name/businessName). */
  dataEncryptionKey: string;
}

export interface RootConfig {
  app: AppConfig;
  log: LogConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  throttle: ThrottleConfig;
  whatsapp: WhatsAppConfig;
  ai: AiConfig;
  storage: StorageConfig;
  security: SecurityConfig;
}

const toBool = (v: string | undefined, def = false): boolean => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const toInt = (v: string | undefined, def: number): number => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const toList = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export default (): RootConfig => ({
  app: {
    env: (process.env.NODE_ENV as AppConfig['env']) ?? 'development',
    name: process.env.APP_NAME ?? 'WABantu API',
    port: toInt(process.env.APP_PORT, 3001),
    url: process.env.APP_URL ?? 'http://localhost:3001',
    apiPrefix: process.env.API_PREFIX ?? 'api',
    apiVersion: process.env.API_VERSION ?? '1',
    corsOrigins: toList(process.env.CORS_ORIGINS),
    trustProxy: toInt(process.env.TRUST_PROXY, 0),
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    format: (process.env.LOG_FORMAT as LogConfig['format']) ?? 'pretty',
  },
  database: {
    system: {
      host: process.env.SYSTEM_DB_HOST ?? 'localhost',
      port: toInt(process.env.SYSTEM_DB_PORT, 5432),
      username: process.env.SYSTEM_DB_USER ?? 'postgres',
      password: process.env.SYSTEM_DB_PASSWORD ?? '',
      database: process.env.SYSTEM_DB_NAME ?? 'jb_system',
      ssl: toBool(process.env.SYSTEM_DB_SSL),
      poolMin: toInt(process.env.SYSTEM_DB_POOL_MIN, 2),
      poolMax: toInt(process.env.SYSTEM_DB_POOL_MAX, 10),
      synchronize: toBool(process.env.SYSTEM_DB_SYNCHRONIZE),
      logging: toBool(process.env.SYSTEM_DB_LOGGING),
    },
    tenant: {
      host: process.env.TENANT_DB_HOST ?? 'localhost',
      port: toInt(process.env.TENANT_DB_PORT, 5432),
      username: process.env.TENANT_DB_USER ?? 'postgres',
      password: process.env.TENANT_DB_PASSWORD ?? '',
      database: process.env.TENANT_DB_NAME ?? 'jb_tenant',
      ssl: toBool(process.env.TENANT_DB_SSL),
      poolMin: toInt(process.env.TENANT_DB_POOL_MIN, 2),
      poolMax: toInt(process.env.TENANT_DB_POOL_MAX, 20),
      synchronize: toBool(process.env.TENANT_DB_SYNCHRONIZE),
      logging: toBool(process.env.TENANT_DB_LOGGING),
      schemaPrefix: process.env.TENANT_SCHEMA_PREFIX ?? 't_',
    },
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toInt(process.env.REDIS_DB, 0),
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'wabantu:',
    bullmqDb: toInt(process.env.BULLMQ_REDIS_DB, 1),
  },
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    sessionTtl: process.env.SESSION_TTL ?? '7d',
    passwordHashRounds: toInt(process.env.PASSWORD_HASH_ROUNDS, 12),
  },
  throttle: {
    ttl: toInt(process.env.THROTTLE_TTL, 60),
    limit: toInt(process.env.THROTTLE_LIMIT, 120),
  },
  whatsapp: {
    provider:
      (process.env.WHATSAPP_PROVIDER as WhatsAppConfig['provider']) ??
      'meta_cloud',
    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v20.0',
    metaAppId: process.env.META_APP_ID ?? '',
    metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? '',
    metaAppSecret: process.env.META_APP_SECRET ?? '',
  },
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    anthropicMaxTokens: toInt(process.env.ANTHROPIC_MAX_TOKENS, 1024),
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER as StorageConfig['driver']) ?? 'local',
    localDir: process.env.STORAGE_LOCAL_DIR ?? './storage/uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
    },
  },
  security: {
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? '',
  },
});
