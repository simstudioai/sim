import { createLogger } from '@sim/logger'
import {
  v2DeleteFileContract,
  v2DownloadFileContract,
  v2RenameFileContract,
} from '@/lib/api/contracts/v2/files'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2FileErrorPolicies,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import {
  rateLimitHeaders,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId] — Download file content (binary).
 *
 * The response carries no JSON envelope, so rate-limit state is surfaced via
 * `X-RateLimit-*` headers. Errors still render the canonical v2 JSON error body.
 * Lookups are workspace-scoped (IDOR-safe): a file in another workspace 404s.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2DownloadFileContract,
  rateLimitEndpoint: 'file-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) return v2Error('NOT_FOUND', 'File not found')

    const buffer = await fetchWorkspaceFileBuffer(fileRecord)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': fileRecord.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileRecord.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileRecord.name)}`,
        'Content-Length': String(buffer.length),
        ...rateLimitHeaders(rateLimit),
      },
    })
  },
})

/**
 * PATCH /api/v2/files/[fileId] — Rename a file.
 *
 * Renaming only; use `POST /api/v2/files/move` to change a file's folder.
 * Names that collide within the destination folder are rejected as `CONFLICT` —
 * unlike upload, which auto-suffixes on the internal surface.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2RenameFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.rename,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
    name: body.name,
  }),
  useCase: renameWorkspaceFile,
  present: async ({ file }) => ({ data: await toV2File(file) }),
})

/**
 * DELETE /api/v2/files/[fileId] — Delete a file.
 *
 * Delegates to the shared orchestration, which is workspace-scoped and records
 * its own audit entry (the request is forwarded so that entry captures client
 * IP / user agent). Orchestration `errorCode`s map to specific v2 codes rather
 * than v1's blanket 500.
 */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteFileContract,
  rateLimitEndpoint: 'file-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds: [fileId],
      request,
    })

    if (!result.success) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to delete file')
      )
    }

    logger.info(`Deleted file ${fileId} from workspace ${workspaceId}`)

    return v2Data({ id: fileId, deleted: true as const }, { rateLimit })
  },
})
