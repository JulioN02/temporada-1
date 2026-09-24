# BOP v1 — multi-stage appliance image (T-7-1, R-PROD-1 / capstone-ui it6 T-6-4).
#
# Stage 1 build: install all workspaces deps + run the SAME quality gate as CI
# (tsc --noEmit both workspaces + vitest + vite build) — a broken image never
# builds. npm 11 gates dependency postinstall scripts: the explicit
# --allow-scripts=esbuild@0.25.12 (plus the root package.json allowScripts
# field) approves the esbuild binary build on fresh installs (it2a B1 finding).
# Stage 2 runtime: production deps only, non-root (USER node), HEALTHCHECK on
# the public /api/health endpoint (R-OBS-1). No build step: Node >= 22.18 runs
# TypeScript natively (type stripping). One image, two entrypoints: the API
# (default CMD) and the worker (compose command override). The UI build is
# baked: runtime copies ui/dist and express serves it with the SPA fallback
# (R-BE-5 / R-PROD-7 modified — single container serves the React SPA at /).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY ui/package.json ui/package.json
RUN npm ci --allow-scripts=esbuild@0.25.12
COPY . .
# Quality gate = CI gate (R-PROD-3 modified): typecheck both workspaces, then
# the production Vite build, then UI tests — build BEFORE test so the
# R-UI-NFR-3 dist secret scan sees ui/dist and asserts (F1, verify #28/W-1).
# Note: the NFR coverage scan reads the openspec specs from the repo root when
# available; inside the Docker build context (capstone/ only) they are absent,
# so it falls back to the pinned 72-ID list (verify #28).
RUN npm run typecheck
RUN npm run build -w ui
RUN npm test -w ui

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY ui/package.json ui/package.json
RUN npm ci --omit=dev --allow-scripts=esbuild@0.25.12
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/scripts ./backend/scripts
# R-PROD-7 (modified): the built SPA — express static + spaFallback serve it
# at / (backend/src/app.ts uiDistDir default resolves to /app/ui/dist here).
COPY --from=build /app/ui/dist ./ui/dist
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.ts"]