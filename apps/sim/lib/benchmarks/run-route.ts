import { describePrincipalAuth, type SessionPrincipal } from '@sim/auth/principal'
import { createLogger, setRequestAuth } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type BenchmarkResponse,
  type BenchmarkRunEvent,
  benchmarkRunEventSchema,
} from '@/lib/api/contracts/benchmarks'
import {
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import type { JsonRouteContext } from '@/lib/api/server/routes/types'
import { requireBenchmarkOperator } from '@/lib/benchmarks/application/access'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  type OrchestrationRequestContext,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BenchmarkRunRoute')
const rateLimit = internalRateLimits.user({
  bucketName: 'benchmark-run',
  config: { maxTokens: 10, refillRate: 2, refillIntervalMs: 60_000 },
})

/** Heartbeats keep proxy idle timeouts independent of healthy benchmark execution time. */
export function withBenchmarkRunStream<Input>(
  prepare: (request: NextRequest, context: JsonRouteContext) => Promise<Input | Response>,
  execute: (args: {
    principal: SessionPrincipal
    input: Input
    request: OrchestrationRequestContext
  }) => Promise<BenchmarkResponse>
) {
  return withRouteHandler<JsonRouteContext | undefined>(async (request, context) => {
    let principal: SessionPrincipal
    try {
      principal = await internalSessionAuth.authenticate()
      setRequestAuth(describePrincipalAuth(principal))
      const rateLimitResponse = await rateLimit.enforce(request, principal)
      if (rateLimitResponse) return rateLimitResponse
      await requireBenchmarkOperator(principal)
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError)
        return NextResponse.json({ error: error.message }, { status: 401 })
      const projected = internalOrchestrationErrorPolicy.project(error)
      if (projected) return NextResponse.json(projected.body, { status: projected.status })
      throw error
    }
    const input = await prepare(request, context ?? {})
    if (input instanceof Response) return input
    const abort = new AbortController()
    const encoder = new TextEncoder()
    let close = (_cancelled = false) => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const send = (event: BenchmarkRunEvent) => {
          if (!closed)
            controller.enqueue(
              encoder.encode(`${JSON.stringify(benchmarkRunEventSchema.parse(event))}\n`)
            )
        }
        const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000)
        const onAbort = () => {
          abort.abort(request.signal.reason)
          close()
        }
        close = (cancelled = false) => {
          if (closed) return
          closed = true
          clearInterval(heartbeat)
          request.signal.removeEventListener('abort', onAbort)
          if (!cancelled) controller.close()
        }
        request.signal.addEventListener('abort', onAbort, { once: true })
        if (request.signal.aborted) {
          onAbort()
          return
        }
        send({ type: 'heartbeat' })
        void (async () => {
          try {
            const result = await execute({
              principal,
              input,
              request: { headers: request.headers, signal: abort.signal },
            })
            send({ type: 'result', ...result })
          } catch (error) {
            const classified = asOrchestrationError(error)
            if (!classified && !abort.signal.aborted)
              logger.error('Benchmark run failed', { error })
            send({
              type: 'error',
              status: statusForOrchestrationError(classified?.code),
              message: messageForOrchestrationError(
                { error: classified?.message, errorCode: classified?.code },
                'Benchmark run failed'
              ).slice(0, 2000),
            })
          } finally {
            close()
          }
        })()
      },
      cancel(reason) {
        abort.abort(reason)
        close(true)
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  })
}
