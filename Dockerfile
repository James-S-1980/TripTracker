FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production PORT=8772
WORKDIR /app
RUN apk add --no-cache su-exec
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node src/*.generated.json ./src/
COPY --chmod=755 docker/triptracker-entrypoint.sh /usr/local/bin/triptracker-entrypoint
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 8772
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]
ENTRYPOINT ["triptracker-entrypoint"]
CMD ["node", "server.js"]
