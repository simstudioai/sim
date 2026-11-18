import { resolveBedrockCredentialSession } from '@/lib/internal/llm/bedrock-credential'
import { getSelectedBedrockCredential } from '@/blocks/utils'
import type { ExecutionContext } from '@/executor/types'
import { resolveVertexCredential } from '@/executor/utils/vertex-credential'
import type { BedrockCredentialSession } from '@/providers/types'

/**
 * The block fields that select a saved model credential. A fallback on another
 * provider drops them, so one provider's credential never reaches another.
 */
export const BLOCK_MODEL_CREDENTIAL_FIELDS = [
  'vertexCredential',
  'bedrockCredential',
  'bedrockAuthMode',
] as const

/** A block's saved model credential selection. */
export type BlockModelCredentialInputs = Parameters<typeof getSelectedBedrockCredential>[0] & {
  vertexCredential?: string
}

/** What a saved credential adds to a provider request; a field is present only when it resolved. */
export interface BlockModelCredentials {
  apiKey?: string
  bedrockSession?: BedrockCredentialSession
}

/**
 * Resolves the saved credential a block's model call signs with: a Vertex AI
 * OAuth or service-account token (returned as `apiKey`), or a Bedrock AWS
 * credential session. Resolution runs for the run's acting user within the
 * workflow's workspace, and a failure fails that attempt rather than letting it
 * fall back to other credentials.
 */
export async function resolveBlockModelCredentials(
  ctx: ExecutionContext,
  providerId: string,
  inputs: BlockModelCredentialInputs,
  callerLabel: string
): Promise<BlockModelCredentials> {
  if (providerId === 'vertex' && inputs.vertexCredential) {
    const apiKey = await resolveVertexCredential({
      credentialId: inputs.vertexCredential,
      actingUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      callerLabel,
    })
    return { apiKey }
  }
  if (providerId !== 'bedrock') return {}
  const credentialId = getSelectedBedrockCredential(inputs)
  if (!credentialId) return {}
  const bedrockSession = await resolveBedrockCredentialSession({
    credentialId,
    actingUserId: ctx.userId,
    workflowId: ctx.workflowId,
    workspaceId: ctx.workspaceId,
    executionId: ctx.executionId,
    signal: ctx.abortSignal,
  })
  return { bedrockSession }
}
