/**
 * Profound Analytics - Custom log integration
 *
 * Buffers HTTP request logs in memory and flushes them in batches to Profound's API.
 * Runs in Node.js (proxy.ts on ECS), so module-level state persists across requests.
 * @see https://docs.tryprofound.com/agent-analytics/custom
 */
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getBaseDomain } from '@/lib/core/utils/urls'

const logger = createLogger('ProfoundAnalytics')

const FLUSH_INTERVAL_MS = 10_000
const MAX_BATCH_SIZE = 500

interface ProfoundLogEntry {
  timestamp: string
  method: string
  host: string
  path: string
  status_code: number
  ip: string
  user_agent: string
  query_params?: Record<string, string>
  referer?: string
}

let buffer: ProfoundLogEntry[] = []
let flushTimer: NodeJS.Timeout | null = null

/**
 * Returns true if Profound analytics is configured.
 */
export function isProfoundEnabled(): boolean {
  return isHosted && Boolean(env.PROFOUND_API_KEY) && Boolean(env.PROFOUND_ENDPOINT)
}

/**
 * Flushes buffered log entries to Profound's API.
 */
async function flush(): Promise<void> {
  if (buffer.length === 0) return

  const apiKey = env.PROFOUND_API_KEY
  if (!apiKey) {
    buffer = []
    return
  }

  const endpoint = env.PROFOUND_ENDPOINT
  if (!endpoint) {
    buffer = []
    return
  }
  const entries = buffer.splice(0, MAX_BATCH_SIZE)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(entries),
    })

    if (!response.ok) {
      logger.error(`Profound API returned ${response.status}`)
    }
  } catch (error) {
    logger.error('Failed to flush logs to Profound', error)
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    flush().catch(() => {})
  }, FLUSH_INTERVAL_MS)
  flushTimer.unref()
}

/**
 * Queues a request log entry for the next batch flush to Profound.
 */
export function sendToProfound(request: Request, statusCode: number): void {
  if (!isProfoundEnabled()) return

  try {
    const url = new URL(request.url)
    const queryParams: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value
    })

    buffer.push({
      timestamp: new Date().toISOString(),
      method: request.method,
      host: getBaseDomain(),
      path: url.pathname,
      status_code: statusCode,
      ip:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        '0.0.0.0',
      user_agent: request.headers.get('user-agent') || '',
      ...(Object.keys(queryParams).length > 0 && { query_params: queryParams }),
      ...(request.headers.get('referer') && { referer: request.headers.get('referer')! }),
    })

    ensureFlushTimer()

    if (buffer.length >= MAX_BATCH_SIZE) {
      flush().catch(() => {})
    }
  } catch (error) {
    logger.error('Failed to enqueue log entry', error)
  }
}
