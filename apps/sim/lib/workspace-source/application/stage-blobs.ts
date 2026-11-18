/**
 * Staging the binary files of a workspace source apply: a client uploads each blob's bytes first,
 * keyed by SHA-256, then sends one apply that names them by hash. Staged blobs are scoped to the
 * workspace and the caller (a person, or a workspace API key), capped per scope
 * (`maxStagedBlobs`, `maxStagedBytes`) and expire a day after they were last used. A client asks
 * which hashes are missing before uploading, so a resumed apply never sends a blob twice.
 */
import type { Principal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import {
  assertStagingFits,
  findStagedBlobs,
  type StagingScope,
  stageBlobs,
  stagedUsage,
} from '@/lib/workspace-source/staging/store'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/**
 * Whose staging area a principal reads and writes: a person's (any of their credentials), or one
 * workspace API key's.
 */
export function stagingScopeOf(principal: Principal, workspaceId: string): StagingScope {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
      return { workspaceId, scope: `user:${principal.userId}` }
    case 'workspace_api_key':
      return { workspaceId, scope: `workspace_api_key:${principal.keyId}` }
    default:
      throw new OrchestrationError('forbidden', 'This caller cannot stage workspace source files.')
  }
}

export interface AdmitSourceBlobStageInput {
  workspaceId: string
}

/**
 * Admits a staging request before its body is read: the caller may write the workspace, the flag
 * is on, and the scope has room for at least one more blob.
 */
export const admitSourceBlobStage = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.stageBlobs,
  resolveContext: ({ input }: { input: AdmitSourceBlobStageInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, context }) {
    await requireWorkflowCodeEnabled()
    const target = stagingScopeOf(principal, context.workspaceId)
    assertStagingFits(await stagedUsage(target), { count: 1, bytes: 1 })
    return { workspaceId: context.workspaceId }
  },
})

export interface StageSourceBlobsInput {
  workspaceId: string
  /** Each blob's bytes under the SHA-256 the client named it by. */
  blobs: ReadonlyArray<{ sha256: string; content: Buffer }>
}

export interface StageSourceBlobsResult {
  workspaceId: string
  staged: Array<{ sha256: string; size: number }>
}

/**
 * Stages a batch of blobs: refuses one over `maxBlobBytes`, a batch over the request caps, and any
 * blob whose bytes do not hash to the SHA-256 it was named by (nothing of the batch is staged),
 * then stores the rest within the scope's caps. Staging a blob already staged only renews it.
 */
export const stageSourceBlobs = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.stageBlobs,
  resolveContext: ({ input }: { input: StageSourceBlobsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<StageSourceBlobsResult> {
    await requireWorkflowCodeEnabled()
    const { maxBlobBytes, maxBlobBytesPerRequest, maxBlobsPerRequest } = WORKSPACE_SOURCE_LIMITS
    if (input.blobs.length === 0) {
      throw new OrchestrationError('validation', 'Send at least one binary file to stage.')
    }
    if (input.blobs.length > maxBlobsPerRequest) {
      throw new OrchestrationError(
        'payload_too_large',
        `A staging request carries at most ${maxBlobsPerRequest} files; this one carries ${input.blobs.length}.`
      )
    }
    let total = 0
    for (const blob of input.blobs) {
      total += blob.content.byteLength
      if (blob.content.byteLength > maxBlobBytes) {
        throw new OrchestrationError(
          'payload_too_large',
          `${blob.sha256} is ${blob.content.byteLength} bytes, over the ${maxBlobBytes}-byte limit.`
        )
      }
      if (sha256Hex(blob.content) !== blob.sha256) {
        throw new OrchestrationError(
          'validation',
          `The bytes sent as ${blob.sha256} have another SHA-256; nothing was staged.`
        )
      }
    }
    if (total > maxBlobBytesPerRequest) {
      throw new OrchestrationError(
        'payload_too_large',
        `A staging request carries at most ${maxBlobBytesPerRequest} bytes; this one carries ${total}.`
      )
    }
    const staged = await stageBlobs(
      stagingScopeOf(principal, context.workspaceId),
      input.blobs.map((blob) => ({ sha256: blob.sha256, bytes: blob.content }))
    )
    return {
      workspaceId: context.workspaceId,
      staged: staged.map(({ sha256, size }) => ({ sha256, size })),
    }
  },
})

export interface FindMissingSourceBlobsInput {
  workspaceId: string
  blobs: ReadonlyArray<{ sha256: string; size: number }>
}

/**
 * Which of `blobs` the caller has not staged in the workspace (or staged at another size), in the
 * order asked; those it has are renewed, so they outlive the apply that follows.
 */
export const findMissingSourceBlobs = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.findMissingBlobs,
  resolveContext: ({ input }: { input: FindMissingSourceBlobsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireWorkflowCodeEnabled()
    if (input.blobs.length > WORKSPACE_SOURCE_LIMITS.maxStagedBlobs) {
      throw new OrchestrationError(
        'payload_too_large',
        `Ask about at most ${WORKSPACE_SOURCE_LIMITS.maxStagedBlobs} files at once.`
      )
    }
    const staged = await findStagedBlobs(
      stagingScopeOf(principal, context.workspaceId),
      input.blobs.map((blob) => blob.sha256)
    )
    const missing = [
      ...new Set(
        input.blobs
          .filter((blob) => staged.get(blob.sha256)?.size !== blob.size)
          .map((blob) => blob.sha256)
      ),
    ]
    return { workspaceId: context.workspaceId, missing }
  },
})
