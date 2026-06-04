import type { ExecutionContext } from '@/lib/copilot/request/types'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getWorkflowById } from '@/lib/workflows/utils'

export async function prepareExecutionContext(
  userId: string,
  workflowId: string,
  chatId?: string,
  options?: {
    workspaceId?: string
    decryptedEnvVars?: Record<string, string>
  }
): Promise<ExecutionContext> {
  const workspaceId =
    options?.workspaceId ?? (await getWorkflowById(workflowId))?.workspaceId ?? undefined
  const decryptedEnvVars =
    options?.decryptedEnvVars ?? (await getEffectiveDecryptedEnv(userId, workspaceId))

  return {
    userId,
    workflowId,
    workspaceId,
    chatId,
    decryptedEnvVars,
  }
}
