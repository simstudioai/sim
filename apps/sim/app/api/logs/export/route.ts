import { db } from '@sim/db'
import { permissions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LogsExportAPI')

export const revalidate = 0

const ExportParamsSchema = z.object({
  level: z.string().optional(),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  folderName: z.string().optional(),
  workspaceId: z.string(),
})

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const params = ExportParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    const selectColumns = {
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      cost: workflowExecutionLogs.cost,
      executionData: workflowExecutionLogs.executionData,
      workflowName: workflow.name,
    }

    let conditions: SQL | undefined = eq(workflow.workspaceId, params.workspaceId)

    if (params.level && params.level !== 'all') {
      conditions = and(conditions, eq(workflowExecutionLogs.level, params.level))
    }

    if (params.workflowIds) {
      const workflowIds = params.workflowIds.split(',').filter(Boolean)
      if (workflowIds.length > 0) conditions = and(conditions, inArray(workflow.id, workflowIds))
    }

    if (params.folderIds) {
      const folderIds = params.folderIds.split(',').filter(Boolean)
      if (folderIds.length > 0) conditions = and(conditions, inArray(workflow.folderId, folderIds))
    }

    if (params.triggers) {
      const triggers = params.triggers.split(',').filter(Boolean)
      if (triggers.length > 0 && !triggers.includes('all')) {
        conditions = and(conditions, inArray(workflowExecutionLogs.trigger, triggers))
      }
    }

    if (params.startDate) {
      conditions = and(conditions, gte(workflowExecutionLogs.startedAt, new Date(params.startDate)))
    }
    if (params.endDate) {
      conditions = and(conditions, lte(workflowExecutionLogs.startedAt, new Date(params.endDate)))
    }

    if (params.search) {
      const term = `%${params.search}%`
      conditions = and(conditions, sql`${workflowExecutionLogs.executionId} ILIKE ${term}`)
    }
    if (params.workflowName) {
      const nameTerm = `%${params.workflowName}%`
      conditions = and(conditions, sql`${workflow.name} ILIKE ${nameTerm}`)
    }
    if (params.folderName) {
      const folderTerm = `%${params.folderName}%`
      conditions = and(conditions, sql`${workflow.name} ILIKE ${folderTerm}`)
    }

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
              .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
              .innerJoin(
                permissions,
                and(
                  eq(permissions.entityType, 'workspace'),
                  eq(permissions.entityId, workflow.workspaceId),
                  eq(permissions.userId, userId)
                )
              )
              .where(conditions)
              .orderBy(desc(workflowExecutionLogs.startedAt))
              .limit(pageSize)
              .offset(offset)

            if (!rows.length) break

            for (const r of rows as any[]) {
              let message = ''
              let traces: any = null
              try {
                const ed = (r as any).executionData
                if (ed) {
                  if (ed.finalOutput)
                    message =
                      typeof ed.finalOutput === 'string'
                        ? ed.finalOutput
                        : JSON.stringify(ed.finalOutput)
                  if (ed.message) message = ed.message
                  if (ed.traceSpans) traces = ed.traceSpans
                }
              } catch {}
              const line = [
                escapeCsv(r.startedAt?.toISOString?.() || r.startedAt),
                escapeCsv(r.level),
                escapeCsv(r.workflowName),
                escapeCsv(r.trigger),
                escapeCsv(r.totalDurationMs ?? ''),
                escapeCsv(r.cost?.total ?? r.cost?.value?.total ?? ''),
                escapeCsv(r.workflowId ?? ''),
                escapeCsv(r.executionId ?? ''),
                escapeCsv(message),
                escapeCsv(traces ? JSON.stringify(traces) : ''),
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
}
