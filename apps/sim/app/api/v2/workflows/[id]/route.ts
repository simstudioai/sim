import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  getActiveWorkflowRecord,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowDetail,
  type V2WorkflowListItem,
  v2DeleteWorkflowContract,
  v2GetWorkflowContract,
  v2UpdateWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { performDeleteWorkflow, performUpdateWorkflow } from '@/lib/workflows/orchestration'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { folderPathForId, resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowDetailAPI')

export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2GetWorkflowContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const snapshot = await loadWorkflowReadSnapshot(id)
      const workflowData = snapshot.workflowRecord
      if (!workflowData?.workspaceId || workflowData.archivedAt) {
        return v2Error('NOT_FOUND', 'Workflow not found')
      }

      // Mask an authorization failure as 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, workflowData.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Workflow not found')

      const folderIndex = await loadActiveFolderPathIndex(workflowData.workspaceId, 'workflow')
      const inputs = extractInputFieldsFromBlocks(snapshot.normalizedData?.blocks ?? {})

      const detail: V2WorkflowDetail = {
        id: workflowData.id,
        name: workflowData.name,
        description: workflowData.description,
        folderPath: folderPathForId(folderIndex, workflowData.folderId),
        workspaceId: workflowData.workspaceId,
        isDeployed: workflowData.isDeployed,
        deployedAt: workflowData.deployedAt?.toISOString() ?? null,
        runCount: workflowData.runCount,
        lastRunAt: workflowData.lastRunAt?.toISOString() ?? null,
        variables: (workflowData.variables as Record<string, unknown> | null) ?? {},
        inputs,
        createdAt: workflowData.createdAt.toISOString(),
        updatedAt: workflowData.updatedAt.toISOString(),
      }

      return v2Data(detail, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Workflow details fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

/** PATCH /api/v2/workflows/[id] — Rename, re-describe, or move a workflow. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateWorkflowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { name, description, folderPath } = parsed.data.body

    const workflowData = await getActiveWorkflowRecord(id)
    if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

    // Mask an authorization failure as 404 so existence is not leaked.
    const access = await resolveWorkspaceAccess(
      rateLimit,
      userId,
      workflowData.workspaceId,
      'write'
    )
    if (access) return v2Error('NOT_FOUND', 'Workflow not found')

    const resolution =
      folderPath === undefined
        ? undefined
        : await resolveFolderPathIdentity({
            workspaceId: workflowData.workspaceId,
            resourceType: 'workflow',
            path: folderPath,
          })
    if (resolution && !resolution.found) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }

    const folderId = resolution?.folderId
    await assertWorkflowMutable(id)
    if (folderId !== undefined) await assertFolderMutable(folderId)

    const result = await performUpdateWorkflow({
      workflowId: id,
      userId,
      workspaceId: workflowData.workspaceId,
      currentName: workflowData.name,
      currentFolderId: workflowData.folderId,
      name,
      description,
      folderId,
      requestId,
    })

    if (!result.success || !result.workflow) {
      return v2ErrorForOrchestration(result.errorCode, result.error ?? 'Failed to update workflow')
    }

    const updated = result.workflow
    const folderIndex = await loadActiveFolderPathIndex(workflowData.workspaceId, 'workflow')
    /**
     * Deployment and run counters are untouched by a metadata update, so they
     * come from the record read above rather than a second query.
     */
    const item: V2WorkflowListItem = {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      folderPath: folderPathForId(folderIndex, updated.folderId),
      workspaceId: updated.workspaceId ?? workflowData.workspaceId,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt?.toISOString() ?? null,
      runCount: workflowData.runCount,
      lastRunAt: workflowData.lastRunAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }

    return v2Data(item, { rateLimit })
  } catch (error) {
    if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
      return v2Error('LOCKED', error.message)
    }

    logger.error(`[${requestId}] Workflow update error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteWorkflowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    const workflowData = await getActiveWorkflowRecord(id)
    if (!workflowData?.workspaceId) return v2Error('NOT_FOUND', 'Workflow not found')

    // Mask an authorization failure as 404 so existence is not leaked.
    const access = await resolveWorkspaceAccess(
      rateLimit,
      userId,
      workflowData.workspaceId,
      'write'
    )
    if (access) return v2Error('NOT_FOUND', 'Workflow not found')

    await assertWorkflowMutable(id)

    const result = await performDeleteWorkflow({ workflowId: id, userId, requestId })
    if (!result.success) {
      return v2ErrorForOrchestration(result.errorCode, result.error ?? 'Failed to delete workflow')
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  } catch (error) {
    if (error instanceof WorkflowLockedError) return v2Error('LOCKED', error.message)

    logger.error(`[${requestId}] Workflow delete error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
