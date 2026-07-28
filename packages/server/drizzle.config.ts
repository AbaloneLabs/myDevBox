import { defineConfig } from 'drizzle-kit'

// drizzle-kit은 자체적으로 TS를 로드하므로 config 모듈 import 대신
// 환경변수를 직접 읽어 의존성을 최소화합니다.
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://mydevbox:mydevbox@localhost:35432/mydevbox'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
