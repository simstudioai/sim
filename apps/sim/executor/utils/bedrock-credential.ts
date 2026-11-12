import { resolveBedrockCredentialSession } from '@/lib/internal/llm/bedrock-credential'
import type { ExecutionContext } from '@/executor/types'
import type { BedrockCredentialSession } from '@/providers/types'

/**
 * The saved AWS credential session a block's Bedrock call signs with, or
 * undefined when the call is not to Bedrock or the block uses inline keys.
 * Shared by the agent, router, and evaluator handlers. Resolution runs for
 * the run's acting user within the workflow's workspace, and a failure fails
 * the call rather than letting it fall back to other credentials.
 */
export async function resolveBlockBedrockSession(
  ctx: ExecutionContext,
  providerId: string,
  credentialId: unknown
): Promise<BedrockCredentialSession | undefined> {
  if (providerId !== 'bedrock' || typeof credentialId !== 'string' || !credentialId.trim()) {
    return undefined
  }
  return resolveBedrockCredentialSession({
    credentialId: credentialId.trim(),
    actingUserId: ctx.userId,
    workflowId: ctx.workflowId,
    workspaceId: ctx.workspaceId,
    executionId: ctx.executionId,
    signal: ctx.abortSignal,
  })
}
