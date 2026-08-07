import { createLogger } from '@sim/logger'
import { v2ImportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import {
  importWorkflowIntoWorkspace,
  MAX_IMPORT_BODY_BYTES,
} from '@/lib/workflows/operations/import-workflow'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { folderPathForId, resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import {
  type V2ErrorCode,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowImportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ERROR_CODE_BY_STATUS: Record<number, V2ErrorCode> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  423: 'LOCKED',
  500: 'INTERNAL_ERROR',
}

/**
 * POST /api/v2/workflows/import
 *
 * Creates a new workflow in the target workspace from an export payload
 * produced by `GET /api/v2/workflows/{id}/export`. The shared
 * {@link importWorkflowIntoWorkspace} pipeline does the heavy lifting; this
 * route authenticates and renders the v2 envelope.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2ImportWorkflowContract,
  rateLimitEndpoint: 'workflow-import',
  parseOptions: {
    maxBodyBytes: MAX_IMPORT_BODY_BYTES,
  },
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    const { workspaceId, folderPath, name, description } = input.body

    logger.info(`[${requestId}] Importing workflow into workspace ${workspaceId}`, {
      userId,
      folderPath,
    })

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const resolution = await resolveFolderPathIdentity({
      workspaceId,
      resourceType: 'workflow',
      path: folderPath ?? '/',
    })
    if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')

    const result = await importWorkflowIntoWorkspace({
      workspaceId,
      folderId: resolution.folderId ?? undefined,
      name,
      description,
      workflow: input.body.workflow,
      userId,
      requestId,
    })

    if (!result.success) {
      return v2Error(ERROR_CODE_BY_STATUS[result.status] ?? 'INTERNAL_ERROR', result.error, {
        status: result.status,
        details: result.details,
      })
    }

    return v2Data(
      {
        id: result.workflow.id,
        name: result.workflow.name,
        description: result.workflow.description,
        workspaceId: result.workflow.workspaceId,
        folderPath: folderPathForId(resolution.index, result.workflow.folderId),
        createdAt: result.workflow.createdAt.toISOString(),
        updatedAt: result.workflow.updatedAt.toISOString(),
      },
      { rateLimit, status: 201 }
    )
  },
})
