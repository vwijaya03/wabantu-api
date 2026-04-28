# syntax=docker/dockerfile:1.7
# =====================================================================
# WABantu API — production image
# Multi-stage so the runtime layer carries only prod deps + dist/.
# =====================================================================

# ---------- 1. Install all deps (incl. dev) for build ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ---------- 2. Build the NestJS bundle ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- 3. Slim runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    APP_PORT=3001

# Drop root for runtime — node user ships with the official image.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3001

# Lightweight container-level liveness probe; orchestrators can also
# call /api/v1/health/ready for richer readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${APP_PORT}/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/main.js"]
