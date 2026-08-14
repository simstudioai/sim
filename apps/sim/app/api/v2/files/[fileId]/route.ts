import {
  v2DeleteFileContract,
  v2DownloadFileContract,
  v2RenameFileContract,
} from '@/lib/api/contracts/v2/files'
import {
  defineV2BinaryRoute,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { encodeFilenameForHeader } from '@/app/api/files/utils'
import { toV2File } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId] — Download file content (binary).
 *
 * The response carries no JSON envelope, so rate-limit state is surfaced via
 * `X-RateLimit-*` headers. Errors still render the canonical v2 JSON error body.
 * Lookups are workspace-scoped (IDOR-safe): a file in another workspace 404s.
 *
 * A generated doc whose artifact is still compiling renders `CONFLICT`; retry.
 *
 * `headSafe: false` because downloading records a `FILE_DOWNLOADED` audit event
 * and pulls the bytes out of object storage.
 */
export const GET = defineV2BinaryRoute({
  contract: v2DownloadFileContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: fileOperations.download,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: downloadWorkspaceFileStream,
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    contentLength,
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
