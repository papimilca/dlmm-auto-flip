# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Prune dev dependencies for the runtime image
RUN pnpm prune --prod

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Run as non-root user
RUN chown -R node:node /app
USER node

CMD ["node", "dist/index.js", "config.json"]
