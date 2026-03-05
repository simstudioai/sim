/**
 * Periodic memory telemetry for diagnosing heap growth in production.
 * Logs process.memoryUsage(), V8 heap stats, and active SSE connection
 * counts every 60s, enabling correlation between connection leaks and
 * memory spikes.
 */

import v8 from 'node:v8'
import { createLogger } from '@sim/logger'
import {
  getActiveSSEConnectionCount,
  getActiveSSEConnectionsByRoute,
} from '@/lib/monitoring/sse-connections'

const logger = createLogger('MemoryTelemetry', { logLevel: 'INFO' })

const MB = 1024 * 1024

let started = false

export function startMemoryTelemetry(intervalMs = 60_000) {
  if (started) return
  started = true

  const timer = setInterval(() => {
    // Trigger opportunistic (non-blocking) garbage collection if running on Bun.
    // This signals JSC GC + mimalloc page purge without blocking the event loop,
    // helping reclaim RSS that mimalloc otherwise retains under sustained load.
    const bunGlobal = (globalThis as Record<string, unknown>).Bun as
      | { gc?: (force: boolean) => void }
      | undefined
    if (typeof bunGlobal?.gc === 'function') {
      bunGlobal.gc(false)
    }

    const mem = process.memoryUsage()
    const heap = v8.getHeapStatistics()

    logger.info('Memory snapshot', {
      heapUsedMB: Math.round(mem.heapUsed / MB),
      heapTotalMB: Math.round(mem.heapTotal / MB),
      rssMB: Math.round(mem.rss / MB),
      externalMB: Math.round(mem.external / MB),
      arrayBuffersMB: Math.round(mem.arrayBuffers / MB),
      heapSizeLimitMB: Math.round(heap.heap_size_limit / MB),
      nativeContexts: heap.number_of_native_contexts,
      activeResources:
        typeof process.getActiveResourcesInfo === 'function'
          ? process.getActiveResourcesInfo().length
          : -1,
      uptimeMin: Math.round(process.uptime() / 60),
      activeSSEConnections: getActiveSSEConnectionCount(),
      sseByRoute: getActiveSSEConnectionsByRoute(),
    })
  }, intervalMs)
  timer.unref()
}
