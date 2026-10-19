# Web app. Build from the repository root (it imports ../sdk):
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://files.example.com/api -t cloud-storage-web .
FROM node:20-alpine AS build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY sdk /repo/sdk
COPY frontend ./
# the API address is compiled into the browser bundle
ARG NEXT_PUBLIC_API_URL=http://localhost:8080/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3097 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# output: 'standalone' puts a minimal server and its dependencies in .next/standalone
COPY --from=build --chown=node:node /repo/frontend/.next/standalone ./
COPY --from=build --chown=node:node /repo/frontend/.next/static ./.next/static
USER node
EXPOSE 3097
CMD ["node", "server.js"]
