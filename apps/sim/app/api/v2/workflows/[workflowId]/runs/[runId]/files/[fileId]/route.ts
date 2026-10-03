import { v2DownloadRunFileContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2BinaryRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { downloadWorkflowRunFileStream } from '@/lib/workflows/application/download-workflow-run-file'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId] — download a file a
 * run produced (binary).
 *
 * This is the byte path out of an async run for an API-key caller: the
 * `UserFile` URLs carried in a run's output point at `/api/files/serve/...`,
 * which rejects `x-api-key` outright.
 *
 * The file is addressed by the id reported on the run resource and resolved
 * against the run's own recorded output, from which the storage key is read.
 * The request never supplies a storage key, so the endpoint cannot be aimed at
 * bytes the run did not produce.
 *
 * Execution files are not retained forever; a `404` after a run's objects have
 * been collected is expected rather than a fault. Unknown run, unknown file,
 * cross-tenant run, and expired object all render the same `File not found`
 * so the response cannot be used to probe which ids exist.
 *
 * `headSafe: false` because downloading records a `FILE_DOWNLOADED` audit event
 * and pulls the bytes out of object storage. `HEAD` therefore runs the
 * authorization phase alone — which is why the use case resolves the addressed
 * file while loading canonical context rather than in `execute`, so a `HEAD`
 * answers the same existence question a `GET` would instead of succeeding for
 * an id that has no file behind it.
 */
export const GET = defineV2BinaryRoute({
  contract: v2DownloadRunFileContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: workflowOperations.downloadRunFile,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealRunAuthorization,
  mapInput: ({ params }) => ({
    workflowId: params.workflowId,
    runId: params.runId,
    fileId: params.fileId,
  }),
  useCase: downloadWorkflowRunFileStream,
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    contentLength,
  }),
})
