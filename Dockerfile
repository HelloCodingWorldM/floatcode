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

VOLUME ["/data"]
EXPOSE 1234
USER node
CMD ["node", "server/index.cjs"]
