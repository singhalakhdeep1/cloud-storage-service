# Cloud Storage Service API. Build from the repository root: docker build -t cloud-storage-api .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY app.ts server.ts ./
COPY config ./config
COPY controllers ./controllers
COPY middleware ./middleware
COPY models ./models
COPY routes ./routes
COPY sdk ./sdk
COPY services ./services
COPY types ./types
COPY utils ./utils
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=5000 \
    LOCAL_STORAGE_PATH=/data/uploads
WORKDIR /app
# logs/ and the local storage directory belong to the unprivileged user the service runs as
RUN mkdir -p /app/logs /data/uploads && chown -R node:node /app /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 5000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/server.js"]
