FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8772
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY scripts/healthcheck.mjs ./scripts/
COPY --from=build /app/dist ./dist
COPY src/*.generated.json ./src/
RUN mkdir -p /app/data
EXPOSE 8772
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "server.js"]
