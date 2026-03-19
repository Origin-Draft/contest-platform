FROM node:22-alpine

WORKDIR /app

RUN corepack enable && \
    addgroup -S app && adduser -S app -G app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/shared packages/shared

RUN pnpm --filter @origin-draft/shared build && pnpm --filter @origin-draft/api build

RUN mkdir -p /app/uploads && chown app:app /app/uploads

USER app
EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
