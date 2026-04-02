import type { ConnectionOptions } from 'bullmq'
import { env, isTruthy } from '@/lib/core/config/env'

export function isBullMQEnabled(): boolean {
  return isTruthy(env.CONCURRENCY_CONTROL_ENABLED) && Boolean(env.REDIS_URL)
}

export function getBullMQConnectionOptions(): ConnectionOptions {
  if (!env.REDIS_URL) {
    throw new Error('BullMQ requires REDIS_URL')
  }

  const redisUrl = new URL(env.REDIS_URL)
  const isTls = redisUrl.protocol === 'rediss:'
  const port = redisUrl.port ? Number.parseInt(redisUrl.port, 10) : 6379
  const dbPath = redisUrl.pathname.replace('/', '')
  const db = dbPath ? Number.parseInt(dbPath, 10) : undefined

  return {
    host: redisUrl.hostname,
    port,
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTls ? { tls: {} } : {}),
  }
}
