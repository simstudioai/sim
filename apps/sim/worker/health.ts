import { createServer } from 'http'
import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('BullMQWorkerHealth')

export interface WorkerHealthServer {
  close: () => Promise<void>
}

interface WorkerHealthCheck {
  redisConnected: boolean
  dispatcherLastWakeAt: number
}

let healthState: WorkerHealthCheck = {
  redisConnected: false,
  dispatcherLastWakeAt: 0,
}

export function updateWorkerHealthState(update: Partial<WorkerHealthCheck>): void {
  healthState = { ...healthState, ...update }
}

export function startWorkerHealthServer(port: number): WorkerHealthServer {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const redis = getRedisClient()
      const redisConnected = redis !== null
      const dispatcherActive =
        healthState.dispatcherLastWakeAt > 0 &&
        Date.now() - healthState.dispatcherLastWakeAt < 30_000

      const healthy = redisConnected && dispatcherActive

      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: healthy,
          redis: redisConnected,
          dispatcher: dispatcherActive,
          lastWakeAgoMs: healthState.dispatcherLastWakeAt
            ? Date.now() - healthState.dispatcherLastWakeAt
            : null,
        })
      )
      return
    }

    if (req.method === 'GET' && req.url === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  server.listen(port, '0.0.0.0', () => {
    logger.info(`Worker health server listening on port ${port}`)
  })

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      }),
  }
}
