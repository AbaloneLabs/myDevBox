import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import { logger } from '../logger.js'

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    reply.code(400).send({
      success: false,
      error: 'Validation Error',
      details: error.issues,
    })
    return
  }

  logger.error({ err: error, url: request.url }, 'Unhandled error')
  reply.code(500).send({
    success: false,
    error: 'Internal Server Error',
  })
}
