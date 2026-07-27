import { buildApp } from './app.js'
import { config } from './config.js'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`MyDevBox server listening on http://${config.host}:${config.port}`)
    app.log.info(`Repos dir: ${config.reposDir}`)
  } catch (err) {
    app.log.error({ err }, 'Failed to start server')
    process.exit(1)
  }
}

main()
