# WABantu API

NestJS 11 backend for the WABantu SaaS. Serves a versioned REST API at
`/api/v1/...` with JWT + Redis session auth and multi-tenant Postgres.

## Module map

```
src/
├── main.ts                     # Bootstrap (helmet, CORS, versioning, pipes)
├── app.module.ts               # Wires every feature module
├── config/
│   ├── configuration.ts        # Typed loader (env -> domain shape)
│   └── env.validation.ts       # Joi schema (fail-fast on bad env)
├── common/
│   ├── filters/                # AllExceptionsFilter
│   ├── interceptors/           # Uniform success envelope
│   ├── guards/                 # RolesGuard
│   ├── decorators/             # @Public, @CurrentUser, @Roles
│   ├── types/                  # AuthUser, AuthenticatedRequest
│   └── utils/                  # slugify, parseDurationToSeconds
├── database/
│   ├── system/                 # jb_system DataSource + entities
│   │   └── entities/
│   │       ├── tenant.entity.ts
│   │       ├── tenant-company.entity.ts
│   │       └── tenant-account.entity.ts
│   └── tenant/                 # jb_tenant entities + per-tenant DS resolver
│       ├── entities/
│       └── tenant-connection.service.ts
├── redis/                      # Shared ioredis client
├── auth/                       # Register, login, logout, JWT, sessions
├── business/                   # Business profile (per-tenant)
├── knowledge-base/             # FAQ entries (per-tenant)
├── whatsapp/                   # Meta Cloud API + webhook
├── inbox/                      # (entities live in database/tenant)
└── health/                     # Liveness + readiness
```

## Auth flow

```
POST /auth/register
  └─ tx in jb_system: insert tenant + tenant_company + tenant_account
  └─ commit, then bootstrap "t_<slug>" schema in jb_tenant + create
     placeholder business_profile row
  └─ create Redis session + sign JWT, return token in HttpOnly cookie

POST /auth/login
  └─ lookup tenant_account by email, bcrypt-compare password
  └─ load tenant + tenant_company (tenantSchema)
  └─ create Redis session, return JWT cookie

GET /auth/me   (JwtAuthGuard)
  └─ JwtStrategy validates JWT signature + Redis session presence
  └─ touches session TTL (sliding expiration)
  └─ returns enriched user with tenant info

POST /auth/logout
  └─ deletes Redis session, clears cookie
```

## Per-tenant data access

Every feature service injects `TenantConnectionService`, then:

```ts
const ds = await this.tenantConn.getDataSourceForTenant(user.tenantId);
const repo = ds.getRepository(BusinessProfile);
const profile = await repo.findOne({ where: {} });
```

The first call for a given `(host, port, database, schema)` boots a
TypeORM DataSource and caches it. Connections close on shutdown via
`OnModuleDestroy`.

## Environment variables

See `.env.example`. Everything is validated by Joi at boot — the API
will refuse to start if anything required is missing or malformed.

Required for first run:

- `SYSTEM_DB_*` and `TENANT_DB_*` — point to the same Postgres cluster
  in dev, and to whatever you want in prod
- `REDIS_HOST`, `REDIS_PORT`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥32 chars; ≥64 in prod)

Optional but recommended:

- `META_WEBHOOK_VERIFY_TOKEN` + `META_APP_SECRET` — for WhatsApp webhook
- `ANTHROPIC_API_KEY` — when you wire the AI auto-reply pipeline

## Running

### Local (npm)

```bash
npm run start:dev   # watch mode
npm run start       # one-shot
npm run start:prod  # production (after `npm run build`)
npm run lint        # eslint + prettier
npm run test        # unit
npm run test:e2e    # e2e
```

### Docker (standalone deploy unit)

This service ships its own `Dockerfile` and `docker-compose.yml`, so it
can be built and shipped without any other repo content. The only
external requirement is the shared `wabantu_net` Docker network created
by `infra/docker-compose.yml`.

```bash
# Make sure infra is up first (only needed once on a host):
cd ../infra && docker compose up -d

# Build & start the API container:
cd ../api && docker compose up -d --build

# Tail logs:
docker compose logs -f api
```

Build & push for a registry:

```bash
docker build -t registry.example.com/wabantu-api:$TAG .
docker push registry.example.com/wabantu-api:$TAG
```

The compose file overrides `SYSTEM_DB_HOST`/`TENANT_DB_HOST`/`REDIS_HOST`
to point at the docker service names (`postgres`, `redis`). Your local
`.env` can keep `localhost` for `npm run start:dev` — both modes work
from the same `.env` file.

## Adding a new tenant-scoped entity

1. Create the entity in `src/database/tenant/entities/`.
2. Add the class to `TENANT_ENTITIES` in `src/database/tenant/tenant-entities.ts`.
3. Build a feature module that injects `TenantConnectionService` and
   resolves a repository per request via `getDataSourceForTenant()`.
4. In dev, the next register/login auto-syncs the schema. In prod,
   ship a migration that runs across every existing tenant schema.

## Adding a new WhatsApp provider

1. Implement `WhatsappProvider` interface in
   `src/whatsapp/providers/<your-provider>.provider.ts`.
2. Register it as a Nest provider in `whatsapp.module.ts`.
3. Inject it into `WhatsappService.providers`.
4. Update `WHATSAPP_PROVIDER` env enum + Joi schema.

The rest of the codebase (auto-reply pipeline, inbox) talks only to
the interface — no other file needs changes.
