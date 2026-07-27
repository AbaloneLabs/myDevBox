import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { errorHandler } from './plugins/error-handler.js'
import { healthRoutes } from './routes/health.js'
import { projectRoutes } from './routes/projects.js'
import { fileRoutes } from './routes/files.js'
import { gitRoutes } from './routes/git.js'
import { agentRoutes } from './routes/agent.js'
import { taskRoutes } from './routes/tasks.js'
import { planRoutes } from './routes/plans.js'
import { docRoutes } from './routes/docs.js'
import { wikiRoutes } from './routes/wiki.js'
import { runRoutes } from './routes/run.js'
import { setupWebSocket } from './ws/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = Fastify({
    // Fastify 5: logger에 설정 객체를 전달 (pino 인스턴스 직접 전달 불가)
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: config.isDev
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
  })

  // CORS (개발 시 모든 origin 허용)
  await app.register(cors, { origin: true })

  // 에러 핸들러
  app.setErrorHandler(errorHandler)

  // API 라우트 (프리픽스: /api)
  await app.register(async (api) => {
    await healthRoutes(api)
    await projectRoutes(api)
    await fileRoutes(api)
    await gitRoutes(api)
    await agentRoutes(api)
    await taskRoutes(api)
    await planRoutes(api)
    await docRoutes(api)
    await wikiRoutes(api)
    await runRoutes(api)
  }, { prefix: '/api' })

  // WebSocket 서버 설정 (Fastify HTTP 서버와 통합)
  setupWebSocket(app)

  // 정적 파일 서빙 (프론트엔드 빌드 결과)
  // 프로덕션에서는 server가 web/dist를 서빙
  const webDistPath = path.resolve(__dirname, '../../web/dist')
  try {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: false,
    })
  } catch (err) {
    app.log.warn({ err }, 'web/dist not found, skipping static file serving')
  }

  return app
}
