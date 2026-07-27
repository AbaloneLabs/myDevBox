# MyDevBox - Server Dockerfile
# 멀티스테이지 빌드. 프로덕션에서는 서버가 API(/api, /ws)와 빌드된
# 프론트엔드 정적 파일(/)을 모두 서빙한다 (단일 origin → 별도 프록시 불필요).

# ---- 빌더 단계: 모노레포 전체 빌드 ----
FROM node:22-alpine AS builder
# git: simple-git용, python3/make/g++: node-pty 네이티브 컴파일용
RUN apk add --no-cache git python3 make g++
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 의존성 파일만 먼저 복사 (캐시 최적화)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
# install 후 네이티브 모듈(node-pty) 강제 빌드
RUN pnpm install --frozen-lockfile; exit 0
RUN cd node_modules/.pnpm/node-pty@*/node_modules/node-pty && npm run install || true
RUN pnpm rebuild

# 소스 복사 및 빌드 (shared → web → server 순서)
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/
COPY packages/web/ ./packages/web/
RUN pnpm --filter @mydevbox/shared build
RUN pnpm --filter @mydevbox/web build
RUN pnpm --filter @mydevbox/server build

# ---- 프로덕션 단계 ----
FROM node:22-alpine AS production
# git: simple-git용 (런타임)
RUN apk add --no-cache git
WORKDIR /app

# 빌더 단계에서 빌드된 의존성 전체 복사 (node-pty 네이티브 모듈 포함)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules

# shared 패키지 (워크스페이스 심볼릭 링크 해결을 위해 전체 복사)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# server 빌드 결과물 + 마이그레이션
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY packages/server/drizzle ./packages/server/drizzle

# web 빌드 결과물 (서버가 정적 서빙: ../../web/dist)
COPY --from=builder /app/packages/web/dist ./packages/web/dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
