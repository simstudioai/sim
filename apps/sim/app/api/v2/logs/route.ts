import { traceSpansSchema } from '@/lib/api/contracts/logs'
import {
  type V2LogListItem,
  v2ListLogsContract,
  v2LogStatusSchema,
} from '@/lib/api/contracts/v2/logs'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { decodePublicLogCursor, listPublicWorkflowLogs } from '@/lib/logs/public-queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { resolveFolderPathId } from '@/app/api/v2/lib/folders'
import { v2CursorList, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withPublicApiRouteHandler({
  contract: v2ListLogsContract,
  rateLimitEndpoint: 'logs',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const params = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, params.workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folderPaths = params.folderPaths?.split(',').filter(Boolean)
    const folderIndex = folderPaths
      ? await loadActiveFolderPathIndex(params.workspaceId, 'workflow')
      : null
    const resolvedFolderIds = folderPaths?.map((path) => resolveFolderPathId(folderIndex!, path))
    if (resolvedFolderIds?.some((folderId) => folderId === undefined)) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }
    const nonRootFolderIds = resolvedFolderIds?.filter(
      (folderId): folderId is string => typeof folderId === 'string'
    )
    const includesRoot = resolvedFolderIds?.includes(null) ?? false

    const decodedCursor = params.cursor
      ? decodePublicLogCursor(params.cursor, params.order ?? 'desc')
      : null
    if (params.cursor && !decodedCursor) return v2Error('BAD_REQUEST', 'Invalid cursor')
    const cursor = decodedCursor ?? undefined
    const includeFullDetails =
      params.details === 'full' || params.includeFinalOutput || params.includeTraceSpans

    const filters = {
      workspaceId: params.workspaceId,
      workflowIds: params.workflowIds?.split(',').filter(Boolean),
      folderIds: nonRootFolderIds,
      triggers: params.triggers?.split(',').filter(Boolean),
      level: params.level,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
      executionId: params.runId,
      minDurationMs: params.minDurationMs,
      maxDurationMs: params.maxDurationMs,
      minCost: params.minCost,
      maxCost: params.maxCost,
      model: params.model,
      cursor,
      order: params.order,
    }

    const { data, nextCursor } = await listPublicWorkflowLogs({
      filters,
      limit: params.limit,
      includeExecutionData: includeFullDetails,
      folderScope: folderPaths ? { includesRoot, folderIds: nonRootFolderIds ?? [] } : undefined,
    })

    type LogRow = (typeof data)[number]
    const buildItem = (log: LogRow): V2LogListItem => {
      const item: V2LogListItem = {
        runId: log.executionId,
        workflowId: log.workflowId,
        deploymentVersionId: log.deploymentVersionId,
        status: v2LogStatusSchema.parse(log.status),
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        totalDurationMs: log.totalDurationMs,
        cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
        files: (log.files as unknown[] | null) ?? null,
      }
      if (includeFullDetails) {
        item.workflow = {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName || log.workflowArchivedAt !== null,
        }
      }
      return item
    }

    const needsMaterialize = params.includeFinalOutput || params.includeTraceSpans

    const formattedLogs = needsMaterialize
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          const item = buildItem(log)
          if (log.executionData) {
            const execData = (await materializeExecutionData(
              log.executionData as Record<string, unknown> | null,
              {
                workspaceId: log.workspaceId,
                workflowId: log.workflowId,
                executionId: log.executionId,
              }
            )) as Record<string, unknown>
            if (params.includeFinalOutput && execData.finalOutput !== undefined) {
              item.finalOutput = execData.finalOutput
            }
            if (params.includeTraceSpans) {
              item.traceSpans = traceSpansSchema.parse(execData.traceSpans ?? [])
            }
          }
          return item
        })
      : data.map(buildItem)

    return v2CursorList(formattedLogs, nextCursor, { rateLimit })
  },
})
