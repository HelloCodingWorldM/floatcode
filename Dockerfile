FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1234 \
    FLOATCODE_DATA_DIR=/data/yjs

EXPOSE 1234
CMD ["sh", "-c", "mkdir -p \"${FLOATCODE_DATA_DIR:-/data/yjs}\" && chown node:node \"${FLOATCODE_DATA_DIR:-/data/yjs}\" && exec su node -s /bin/sh -c 'exec node server/index.cjs'"]
