import type { ExecutionContext } from '@/lib/copilot/request/types'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getWorkflowById } from '@/lib/workflows/utils'

export async function prepareExecutionContext(
  userId: string,
  workflowId: string,
  chatId?: string
): Promise<ExecutionContext> {
  const wf = await getWorkflowById(workflowId)
  const workspaceId = wf?.workspaceId ?? undefined

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  return {
    userId,
    workflowId,
    workspaceId,
    chatId,
    decryptedEnvVars,
  }
}
