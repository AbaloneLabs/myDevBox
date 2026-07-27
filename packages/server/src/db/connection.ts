import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { config } from '../config.js'
import * as schema from './schema.js'

const client = postgres(config.databaseUrl, { max: 10 })

export const db = drizzle(client, { schema })

export type Database = typeof db

// 이 모듈(src/db 또는 dist/db) 기준 ../../drizzle = packages/server/drizzle.
// dev(tsx, src/)와 prod(dist/) 양쪽에서 같은 깊이라 한 경로로 해결됨.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(__dirname, '../../drizzle')

/** 서버 기동 시 마이그레이션 자동 적용 (프로덕션 배포용). */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder })
}
