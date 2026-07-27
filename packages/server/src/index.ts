import { buildApp } from './app.js'
import { config } from './config.js'
import { startWikiSchedulers } from './services/wiki-scheduler.js'
import { runMigrations } from './db/connection.js'

async function main(): Promise<void> {
  await runMigrations()
  const app = await buildApp()

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`MyDevBox server listening on http://${config.host}:${config.port}`)
    app.log.info(`Repos dir: ${config.reposDir}`)
    startWikiSchedulers()
  } catch (err) {
    app.log.error({ err }, 'Failed to start server')
    process.exit(1)
  }
}

main()
