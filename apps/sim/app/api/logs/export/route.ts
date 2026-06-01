import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { buildFilterConditions, LogFilterParamsSchema } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'

const logger = createLogger('LogsExportAPI')

export const revalidate = 0

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
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

    const header = [
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
    ].join(',')

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(encoder.encode(`${header}\n`))
        const pageSize = 1000
        let offset = 0
        try {
          while (true) {
            const rows = await db
              .select(selectColumns)
              .from(workflowExecutionLogs)
              .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
              .innerJoin(
                permissions,
                and(
                  eq(permissions.entityType, 'workspace'),
                  eq(permissions.entityId, workflowExecutionLogs.workspaceId),
                  eq(permissions.userId, userId)
                )
              )
              .where(conditions)
              .orderBy(desc(workflowExecutionLogs.startedAt))
              .limit(pageSize)
              .offset(offset)

            if (!rows.length) break

            // Heavy execution data may live in object storage; materialize per
            // row with bounded concurrency so a 1000-row page doesn't fan out
            // into 1000 simultaneous reads.
            const materialized = await mapWithConcurrency(
              rows as any[],
              MATERIALIZE_CONCURRENCY,
              (r) =>
                materializeExecutionData(r.executionData as Record<string, unknown> | null, {
                  workspaceId: params.workspaceId,
                  workflowId: r.workflowId,
                  executionId: r.executionId,
                })
            )

            for (let j = 0; j < rows.length; j++) {
              const r = rows[j] as any
              const ed = materialized[j] as Record<string, any>
              // A single malformed/unserializable row must not abort the whole CSV
              // stream — derive the message/trace columns defensively and fall back
              // to empty on error so the row's metadata still exports.
              let message = ''
              let tracesJson = ''
              try {
                if (ed) {
                  if (ed.finalOutput)
                    message =
                      typeof ed.finalOutput === 'string'
                        ? ed.finalOutput
                        : JSON.stringify(ed.finalOutput)
                  if (ed.message) message = ed.message
                  if (ed.traceSpans) tracesJson = JSON.stringify(ed.traceSpans)
                }
              } catch (rowError) {
                logger.warn('Skipping unserializable execution data for export row', {
                  executionId: r.executionId,
                  error: rowError instanceof Error ? rowError.message : String(rowError),
                })
              }
              const line = [
                escapeCsv(r.startedAt?.toISOString?.() || r.startedAt),
                escapeCsv(r.level),
                escapeCsv(r.workflowName),
                escapeCsv(r.trigger),
                escapeCsv(r.totalDurationMs ?? ''),
                escapeCsv(r.costTotal ?? ''),
                escapeCsv(r.workflowId ?? ''),
                escapeCsv(r.executionId ?? ''),
                escapeCsv(message),
                escapeCsv(tracesJson),
              ].join(',')
              controller.enqueue(encoder.encode(`${line}\n`))
            }

            offset += pageSize
          }
          controller.close()
        } catch (e: any) {
          logger.error('Export stream error', { error: e?.message })
          try {
            controller.error(e)
          } catch {}
        }
      },
    })

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `logs-${ts}.csv`

    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    logger.error('Export error', { error: error?.message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
