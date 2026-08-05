# Build from the repository root:
#   docker build -f frontend/Dockerfile .
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/postcss.config.cjs frontend/tailwind.config.cjs ./
# The frontend's @contracts alias resolves this source directory from /app.
COPY api/src/shared /api/src/shared
COPY frontend/src ./src
RUN npm run build

FROM nginx:1.29-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget --spider -q http://127.0.0.1:5173/ || exit 1
