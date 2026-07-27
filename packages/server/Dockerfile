# MyDevBox - Backend Server Dockerfile
# 멀티스테이지 빌드: 모노레포 빌드 후 프로덕션 실행

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
# install 후 네이티브 모듈(node-pty) 강제 빌드
RUN pnpm install --frozen-lockfile; exit 0
# node-pty 네이티브 모듈 직접 빌드 (pnpm rebuild가 동작하지 않는 경우 대비)
RUN cd node_modules/.pnpm/node-pty@*/node_modules/node-pty && npm run install || true
RUN pnpm rebuild

# 소스 복사 및 빌드
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/
RUN pnpm --filter @mydevbox/shared build
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

# server 빌드 결과물 복사
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY packages/server/drizzle ./packages/server/drizzle

EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
