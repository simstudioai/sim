import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { deleteSession } from '@/lib/managed-agents/session-client'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentDeleteSessionParams,
  ManagedAgentDeleteSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentDeleteSessionOperation: InternalToolOperationImplementation<
  ManagedAgentDeleteSessionParams
> = async (params, signal): Promise<ManagedAgentDeleteSessionResponse> => {
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: { sessionId: '', deleted: false }, error: target.error }
  }

  try {
    await deleteSession({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      ...(signal ? { signal } : {}),
    })
    return { success: true, output: { sessionId: target.sessionId, deleted: true } }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, deleted: false },
      error: getErrorMessage(error, 'Failed to delete Managed Agent session'),
    }
  }
}
