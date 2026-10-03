import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { db } from '@sim/db'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/mothership/generated/trace-events-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Measures client-side query time, including any pool wait; never records SQL or values. */
export async function traceMothershipQuery<T>(
  operation: string,
  table: string,
  query: () => PromiseLike<T>
): Promise<T> {
  return trace.getTracer('sim-copilot-db', '1.0.0').startActiveSpan(
    TraceSpan.CopilotDbQuery,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [TraceAttr.DbSystem]: 'postgresql',
        [TraceAttr.DbOperation]: operation,
        [TraceAttr.DbSqlTable]: table,
      },
    },
    async (span) => {
      try {
        return await query()
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    }
  )
}

/** Ready includes acquisition and BEGIN; the trailing interval includes COMMIT/ROLLBACK. */
export async function traceMothershipTransaction<T>(
  operation: string,
  body: (tx: Transaction) => Promise<T>
): Promise<T> {
  return trace
    .getTracer('sim-copilot-db', '1.0.0')
    .startActiveSpan(
      TraceSpan.CopilotDbTransaction,
      { attributes: { [TraceAttr.DbSystem]: 'postgresql', [TraceAttr.DbOperation]: operation } },
      async (span) => {
        try {
          return await db.transaction(async (tx) => {
            span.addEvent(TraceEvent.CopilotDbTransactionReady)
            try {
              return await body(tx)
            } finally {
              span.addEvent(TraceEvent.CopilotDbTransactionBodyComplete)
            }
          })
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      }
    )
}
