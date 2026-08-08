import {
  v2DeleteFileContract,
  v2DescribeFileContract,
  v2RenameFileContract,
} from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { describeWorkspaceFile } from '@/lib/workspace-files/application/describe-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { toV2File, toV2FileSharing } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId] — Describe one file and its sharing state.
 */
export const GET = defineV2JsonRoute({
  contract: v2DescribeFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readMetadata,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: describeWorkspaceFile,
  present: async ({ file, share }) => ({
    data: { ...(await toV2File(file)), sharing: toV2FileSharing(share) },
  }),
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
 * Uses the shared workspace-file application operation, which canonicalizes the
 * resource, authorizes the API-key principal, archives it, and records the
 * semantic audit/notification side effects once.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: deleteWorkspaceFileOperation,
  present: ({ id, deleted }) => ({ data: { id, deleted } }),
})
