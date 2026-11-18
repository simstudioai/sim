import { WORKSPACE_SOURCE_STAGE_MAX_BYTES } from '@sim/workspace-code/limits'
import { v2StageWorkspaceSourceBlobsContract } from '@/lib/api/contracts/v2/workspace-source'
import { defineV2BodyLifecycleRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isMultipartFieldValidationError,
  isPayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { v2WorkspaceSourceErrorPolicy } from '@/lib/workspace-source/api/route-policies'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import {
  admitSourceBlobStage,
  stageSourceBlobs,
} from '@/lib/workspace-source/application/stage-blobs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SHA256 = /^[0-9a-f]{64}$/

/**
 * POST /api/v2/workspaces/[workspaceId]/source/blobs — stages the binary files of a workspace
 * source apply: a multipart form with one file part per blob, named by its SHA-256. The caller's
 * write access and staging room are checked before the body is read; a part whose bytes hash to
 * another SHA-256 refuses the batch. Draws on its own staging budget, not the source-write one.
 */
export const POST = defineV2BodyLifecycleRoute({
  contract: v2StageWorkspaceSourceBlobsContract,
  auth: v2ApiKeyAuth,
  operation: workspaceSourceOperations.stageBlobs,
  rateLimit: v2RateLimits.sourceBlobStage,
  errorPolicy: v2WorkspaceSourceErrorPolicy,
  admission: {
    mapInput: ({ params }) => ({ workspaceId: params.workspaceId }),
    useCase: admitSourceBlobStage,
  },
  async readBody({ request }) {
    let form: FormData
    try {
      form = await readFormDataWithLimit(request, {
        maxBytes: WORKSPACE_SOURCE_STAGE_MAX_BYTES,
        label: 'workspace source staging body',
      })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) throw error
      if (isMultipartFieldValidationError(error)) {
        throw new OrchestrationError('validation', error.message)
      }
      throw new OrchestrationError('validation', 'Request body must be valid multipart form data')
    }
    const blobs: Array<{ sha256: string; content: Buffer }> = []
    for (const [name, value] of form.entries()) {
      if (!SHA256.test(name) || !(value instanceof File)) {
        throw new OrchestrationError(
          'validation',
          'Each form part must be a file named by the SHA-256 of its bytes (64 lowercase hex digits).'
        )
      }
      blobs.push({
        sha256: name,
        content: await readFileToBufferWithLimit(value, {
          maxBytes: WORKSPACE_SOURCE_STAGE_MAX_BYTES,
          label: 'workspace source blob',
        }),
      })
    }
    return blobs
  },
  mapInput: ({ parsed, body }) => ({ workspaceId: parsed.params.workspaceId, blobs: body }),
  useCase: stageSourceBlobs,
  present: (result) => ({ data: result }),
})
