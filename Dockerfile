FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/kiosk/package.json apps/kiosk/package.json
COPY apps/spike-3d/package.json apps/spike-3d/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/kiosk apps/kiosk
COPY server server
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    DB_PATH=/app/server/data/luckydraw.sqlite

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/kiosk/package.json apps/kiosk/package.json
COPY apps/spike-3d/package.json apps/spike-3d/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node packages/shared packages/shared
COPY --chown=node:node server server
COPY --from=build --chown=node:node /app/apps/kiosk/dist apps/kiosk/dist

RUN mkdir -p /app/server/data && chown node:node /app/server/data

USER node
WORKDIR /app/server

EXPOSE 8788

CMD ["npm", "start"]
