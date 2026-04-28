import * as Joi from 'joi';

/**
 * Joi schema validating all required env vars at boot time.
 * If anything is missing/invalid, the app fails fast — much better than
 * crashing later with a confusing error in production.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),

  APP_NAME: Joi.string().default('WABantu API'),
  APP_PORT: Joi.number().port().default(3001),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('1'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  TRUST_PROXY: Joi.number().min(0).default(0),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  LOG_FORMAT: Joi.string().valid('pretty', 'json').default('pretty'),

  // System DB
  SYSTEM_DB_HOST: Joi.string().required(),
  SYSTEM_DB_PORT: Joi.number().port().required(),
  SYSTEM_DB_USER: Joi.string().required(),
  SYSTEM_DB_PASSWORD: Joi.string().allow('').required(),
  SYSTEM_DB_NAME: Joi.string().required(),
  SYSTEM_DB_SSL: Joi.boolean().default(false),
  SYSTEM_DB_POOL_MIN: Joi.number().min(0).default(2),
  SYSTEM_DB_POOL_MAX: Joi.number().min(1).default(10),
  SYSTEM_DB_SYNCHRONIZE: Joi.boolean().default(false),
  SYSTEM_DB_LOGGING: Joi.boolean().default(false),

  // Tenant DB
  TENANT_DB_HOST: Joi.string().required(),
  TENANT_DB_PORT: Joi.number().port().required(),
  TENANT_DB_USER: Joi.string().required(),
  TENANT_DB_PASSWORD: Joi.string().allow('').required(),
  TENANT_DB_NAME: Joi.string().required(),
  TENANT_DB_SSL: Joi.boolean().default(false),
  TENANT_DB_POOL_MIN: Joi.number().min(0).default(2),
  TENANT_DB_POOL_MAX: Joi.number().min(1).default(20),
  TENANT_DB_SYNCHRONIZE: Joi.boolean().default(false),
  TENANT_DB_LOGGING: Joi.boolean().default(false),
  TENANT_SCHEMA_PREFIX: Joi.string()
    .pattern(/^[a-z_][a-z0-9_]*$/)
    .default('t_'),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().min(0).default(0),
  REDIS_KEY_PREFIX: Joi.string().default('wabantu:'),
  BULLMQ_REDIS_DB: Joi.number().min(0).default(1),

  // Auth
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  SESSION_TTL: Joi.string().default('7d'),
  PASSWORD_HASH_ROUNDS: Joi.number().min(8).max(15).default(12),

  // Throttle
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(120),

  // WhatsApp
  WHATSAPP_PROVIDER: Joi.string()
    .valid('meta_cloud', 'baileys')
    .default('meta_cloud'),
  META_GRAPH_API_VERSION: Joi.string().default('v20.0'),
  META_WEBHOOK_VERIFY_TOKEN: Joi.string().allow('').default(''),
  META_APP_SECRET: Joi.string().allow('').default(''),

  // AI
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-5'),
  ANTHROPIC_MAX_TOKENS: Joi.number().min(1).default(1024),

  // Storage
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./storage/uploads'),
  S3_ENDPOINT: Joi.string().allow('').optional(),
  S3_REGION: Joi.string().allow('').optional(),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_SECRET_KEY: Joi.string().allow('').optional(),

  // Field-level encryption
  DATA_ENCRYPTION_KEY: Joi.string().min(32).required(),
});
