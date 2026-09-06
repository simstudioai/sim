import { resolvePrincipalSubject } from '@sim/auth/principal'
import sharp, { type Metadata } from 'sharp'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { assertUserFileContentAccess } from '@/lib/execution/payloads/materialization.server'
import { OciVisionOperationError } from '@/lib/internal/oci-vision/errors'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { isModelSafeWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { extractStorageKey, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { readWorkspaceFileRecordByKey } from '@/lib/workspace-files/application/read-workspace-file-content-by-key'
import { OCI_VISION_MAX_IMAGE_BYTES } from '@/tools/oci_vision/shared'

/** Reads only authorized stored image bytes, never a caller-supplied URL or inline override. */
export async function readOciVisionImage(
  file: RawFileInput,
  context: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  if (!context.workspaceId || !context.executorDelegationOrigin) {
    throw new OciVisionOperationError('Trusted execution context is required for image files', 403)
  }
  if (file.base64 !== undefined) {
    throw new OciVisionOperationError('Stored image files cannot include inline byte overrides')
  }
  const key = file.key || extractStorageKey(file.path || file.url || '')
  if (!key || key.length > 4096)
    throw new OciVisionOperationError('An uploaded image file is required')
  const storageContext = inferContextFromKey(key)
  if (file.context && file.context !== storageContext) {
    throw new OciVisionOperationError('File context does not match its storage key')
  }
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  })
  const subject = resolvePrincipalSubject(principal)
  const userId = subject?.kind === 'sim_user' ? subject.userId : undefined
  await assertUserFileContentAccess(
    { key, context: storageContext },
    {
      principal,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      largeValueExecutionIds: context.largeValueExecutionIds,
      fileKeys: context.fileKeys,
      allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
      userId,
    }
  )
  assertKnownSizeWithinLimit(file.size, OCI_VISION_MAX_IMAGE_BYTES, 'image')
  if (storageContext === 'workspace') {
    const { file: canonical } = await readWorkspaceFileRecordByKey.execute({
      principal,
      input: { key, assertedWorkspaceId: context.workspaceId },
    })
    assertKnownSizeWithinLimit(canonical.size, OCI_VISION_MAX_IMAGE_BYTES, 'image')
  }
  if (
    !(await isModelSafeWorkspaceFileKey(key, {
      workspaceId: context.workspaceId,
      actorUserId: userId,
    }))
  ) {
    throw new OciVisionOperationError('Image file is not safe for model input')
  }
  signal?.throwIfAborted()
  const bytes = await downloadFile({
    key,
    context: storageContext,
    maxBytes: OCI_VISION_MAX_IMAGE_BYTES,
    signal,
  })
  signal?.throwIfAborted()
  assertKnownSizeWithinLimit(bytes.length, OCI_VISION_MAX_IMAGE_BYTES, 'image')
  const mimeType = sniffImageContentType(bytes)
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    throw new OciVisionOperationError('OCI Vision requires JPEG or PNG image bytes')
  }
  let metadata: Metadata
  try {
    metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata()
  } catch {
    throw new OciVisionOperationError('Image dimensions could not be read')
  }
  signal?.throwIfAborted()
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 32 ||
    metadata.height < 32 ||
    metadata.width > 10000 ||
    metadata.height > 10000 ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new OciVisionOperationError(
      'Image must be a single JPEG or PNG from 32×32 to 10000×10000 pixels'
    )
  }
  return bytes
}
