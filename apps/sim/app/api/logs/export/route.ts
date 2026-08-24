import { dbReplica } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { buildFilterConditions, LogFilterParamsSchema } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('LogsExportAPI')
const LOG_EXPORT_PAGE_SIZE = 100

export const revalidate = 0

interface LogExportRow {
  id: string
  workflowId: string | null
  executionId: string
  level: string
  trigger: string
  startedAt: Date
  startedAtCursor: string
  endedAt: Date | null
  totalDurationMs: number | null
  costTotal: string | null
  executionData: unknown
  workflowName: string
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const params = LogFilterParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    const selectColumns = {
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      startedAtCursor: sql<string>`${workflowExecutionLogs.startedAt}::text`,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
      executionData: workflowExecutionLogs.executionData,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
    }

    if (params.folderIds) {
      params.folderIds = await expandFolderIdsWithDescendants(params.workspaceId, params.folderIds)
    }

    const workspaceCondition = eq(workflowExecutionLogs.workspaceId, params.workspaceId)
    const filterConditions = buildFilterConditions(params)
    const conditions = filterConditions
      ? and(workspaceCondition, filterConditions)
      : workspaceCondition

    const header = toCsvRow([
      'startedAt',
      'level',
      'workflow',
      'trigger',
      'durationMs',
      'costTotal',
      'workflowId',
      'executionId',
      'message',
      'traceSpans',
    ])

    const access = await checkWorkspaceAccess(params.workspaceId, userId)
    if (!access.hasAccess) {
      return new NextResponse(`${header}\n`, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="logs-export.csv"',
          'Cache-Control': 'no-cache',
        },
      })
    }

    const encoder = new TextEncoder()
    const csvChunks = (async function* () {
      yield encoder.encode(`${header}\n`)
      const pageSize = LOG_EXPORT_PAGE_SIZE
      let cursor: { startedAt: string; id: string } | null = null
      while (true) {
        const cursorCondition: SQL | undefined = cursor
          ? or(
              lt(workflowExecutionLogs.startedAt, sql`${cursor.startedAt}::timestamp`),
              and(
                eq(workflowExecutionLogs.startedAt, sql`${cursor.startedAt}::timestamp`),
                lt(workflowExecutionLogs.id, cursor.id)
              )
            )
          : undefined
        const rows: LogExportRow[] = await dbReplica
          .select(selectColumns)
          .from(workflowExecutionLogs)
          .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
          .where(and(conditions, cursorCondition))
          .orderBy(desc(workflowExecutionLogs.startedAt), desc(workflowExecutionLogs.id))
          .limit(pageSize)

        if (!rows.length) break

        for (let chunkStart = 0; chunkStart < rows.length; chunkStart += MATERIALIZE_CONCURRENCY) {
          const chunk = rows.slice(chunkStart, chunkStart + MATERIALIZE_CONCURRENCY)
          const materialized = await mapWithConcurrency(chunk, MATERIALIZE_CONCURRENCY, (row) =>
            materializeExecutionDataForDisplay(
              row.executionData as Record<string, unknown> | null,
              {
                workspaceId: params.workspaceId,
                workflowId: row.workflowId,
                executionId: row.executionId,
                userId: session.user.id,
              }
            )
          )

          for (let index = 0; index < chunk.length; index++) {
            const row = chunk[index]
            const executionData = materialized[index]
            let message: unknown = ''
            let tracesJson = ''
            try {
              if (executionData.finalOutput) {
                message =
                  typeof executionData.finalOutput === 'string'
                    ? executionData.finalOutput
                    : (JSON.stringify(executionData.finalOutput) ?? '')
              }
              if (executionData.message) message = executionData.message
              if (executionData.traceSpans) {
                tracesJson = JSON.stringify(executionData.traceSpans) ?? ''
              }
            } catch (rowError) {
              logger.warn('Skipping unserializable execution data for export row', {
                executionId: row.executionId,
                error: getErrorMessage(rowError),
              })
            }
            const line = toCsvRow([
              formatCsvValue(row.startedAt),
              formatCsvValue(row.level),
              formatCsvValue(row.workflowName),
              formatCsvValue(row.trigger),
              formatCsvValue(row.totalDurationMs ?? ''),
              formatCsvValue(row.costTotal ?? ''),
              formatCsvValue(row.workflowId ?? ''),
              formatCsvValue(row.executionId),
              formatCsvValue(message),
              formatCsvValue(tracesJson),
            ])
            yield encoder.encode(`${line}\n`)
          }
        }

        const last = rows.at(-1)
        if (!last || rows.length < pageSize) break
        cursor = { startedAt: last.startedAtCursor, id: last.id }
      }
    })()

    let cancelled = false
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            const next = await csvChunks.next()
            if (cancelled) return
            if (next.done) {
              controller.close()
              return
            }
            controller.enqueue(next.value)
          } catch (error) {
            if (cancelled) return
            logger.error('Export stream error', { error: getErrorMessage(error) })
            controller.error(error)
          }
        },
        cancel: async () => {
          cancelled = true
          await csvChunks.return(undefined)
        },
      },
      { highWaterMark: 0 }
    )

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `logs-${ts}.csv`

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    logger.error('Export error', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
