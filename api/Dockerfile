# Build from the repository root:
#   docker build -f api/Dockerfile .
FROM node:22-bookworm-slim AS build

# better-sqlite3 falls back to compiling from source when no prebuilt binary
# matches the platform, which is the usual case on arm64.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/tsconfig.json ./
COPY api/src ./src
# Operator scripts live outside rootDir and run through tsx, so they are not
# compiled into dist. They stay in this stage for the `tools` compose service.
COPY api/scripts ./scripts
RUN npm run build

# Production dependency tree, resolved in a throwaway stage so the build stage
# keeps tsx and the rest of the toolchain available for operator scripts.
FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/var/lib/somnoscribe/db/cases.sqlite \
    CHARTS_DIR=/var/lib/somnoscribe/charts \
    SLICES_DIR=/var/lib/somnoscribe/slices \
    SCREENSHOTS_DIR=/var/lib/somnoscribe/screenshots

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY api/package.json ./

RUN mkdir -p /var/lib/somnoscribe/db /var/lib/somnoscribe/screenshots \
 && chown -R node:node /var/lib/somnoscribe /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
