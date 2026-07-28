# MyDevBox - Web Frontend Dockerfile
# 멀티스테이지 빌드: 모노레포 전체 빌드 후 정적 서빙

# ---- 빌더 단계: 모노레포 전체 빌드 ----
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# 의존성 파일만 먼저 복사 (캐시 최적화)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

# 소스 복사 및 빌드
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/
RUN pnpm --filter @mydevbox/shared build
RUN pnpm --filter @mydevbox/web build

# ---- 프로덕션 단계: 정적 파일 서빙 ----
FROM node:22-alpine AS production
WORKDIR /app
RUN npm install -g serve@14
COPY --from=builder /app/packages/web/dist ./dist
EXPOSE 35173
CMD ["serve", "-s", "dist", "-l", "35173"]
