import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { archiveSession } from '@/lib/managed-agents/session-client'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentArchiveSessionParams,
  ManagedAgentArchiveSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentArchiveSessionOperation: InternalToolOperationImplementation<
  ManagedAgentArchiveSessionParams
> = async (params, signal): Promise<ManagedAgentArchiveSessionResponse> => {
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: { sessionId: '', archived: false }, error: target.error }
  }

  try {
    await archiveSession({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      ...(signal ? { signal } : {}),
    })
    return { success: true, output: { sessionId: target.sessionId, archived: true } }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, archived: false },
      error: getErrorMessage(error, 'Failed to archive Managed Agent session'),
    }
  }
}
