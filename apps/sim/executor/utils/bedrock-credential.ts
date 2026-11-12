import { resolveBedrockCredentialSession } from '@/lib/internal/llm/bedrock-credential'
import { getSelectedBedrockCredential } from '@/blocks/utils'
import type { ExecutionContext } from '@/executor/types'
import type { BedrockCredentialSession } from '@/providers/types'

/**
 * The saved AWS credential session a block's Bedrock call signs with, or
 * undefined when the call is not to Bedrock or the block uses access keys.
 * Shared by the agent, router, and evaluator handlers. Resolution runs for
 * the run's acting user within the workflow's workspace, and a failure fails
 * the call rather than letting it fall back to other credentials.
 */
export async function resolveBlockBedrockSession(
  ctx: ExecutionContext,
  providerId: string,
  inputs: Parameters<typeof getSelectedBedrockCredential>[0]
): Promise<BedrockCredentialSession | undefined> {
  if (providerId !== 'bedrock') return undefined
  const credentialId = getSelectedBedrockCredential(inputs)
  if (!credentialId) return undefined
  return resolveBedrockCredentialSession({
    credentialId,
    actingUserId: ctx.userId,
    workflowId: ctx.workflowId,
    workspaceId: ctx.workspaceId,
    executionId: ctx.executionId,
    signal: ctx.abortSignal,
  })
}
