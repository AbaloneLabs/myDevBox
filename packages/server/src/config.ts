import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export interface ServerConfig {
  port: number
  host: string
  reposDir: string
  databaseUrl: string
  encryptionKey: string
  isDev: boolean
}

export function getConfig(): ServerConfig {
  const isDocker = fs.existsSync('/.dockerenv') || !!process.env.MYDEVBOX_DOCKER
  const isDev = process.env.NODE_ENV !== 'production'

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    reposDir: process.env.MYDEVBOX_REPOS_DIR
      ?? (isDocker ? '/root/repos' : path.join(os.homedir(), 'repos')),
    databaseUrl: process.env.DATABASE_URL
      ?? (isDocker
        ? 'postgresql://mydevbox:mydevbox@db:5432/mydevbox'
        : 'postgresql://mydevbox:mydevbox@localhost:5432/mydevbox'),
    encryptionKey: process.env.ENCRYPTION_KEY
      ?? process.env.MYDEVBOX_ENCRYPTION_KEY
      ?? `mydevbox-${os.hostname()}-${os.userInfo().uid}`,
    isDev,
  }
}

export const config = getConfig()
