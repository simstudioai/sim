import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { updateSession } from '@/lib/managed-agents/session-client'
import { isTruthyAck, normalizeSessionParameters } from '@/tools/managed_agent/normalizers'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentUpdateSessionParams,
  ManagedAgentUpdateSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentUpdateSessionOperation: InternalToolOperationImplementation<
  ManagedAgentUpdateSessionParams
> = async (params, signal): Promise<ManagedAgentUpdateSessionResponse> => {
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: { sessionId: '', updated: false }, error: target.error }
  }

  // A whitespace-only title is treated as "not provided", not as a request to
  // blank the session's title — otherwise a stray space in the field would
  // both slip past the guard below and silently clear an existing title.
  const trimmedTitle = params.title?.trim()
  const title = trimmedTitle ? trimmedTitle : undefined

  // Clearing metadata needs its own explicit signal. An empty metadata table
  // cannot mean "clear": a table the author never touched is also empty, so
  // inferring intent from emptiness would wipe a session's metadata on every
  // title-only update. `{}` is only sent when the author asks for it.
  const clearMetadata = isTruthyAck(params.clearMetadata)
  const metadata = clearMetadata ? {} : normalizeSessionParameters(params.sessionParameters)
  if (title === undefined && metadata === undefined) {
    return {
      success: false,
      output: { sessionId: target.sessionId, updated: false },
      error: 'Provide a title or metadata to update, or check "Clear metadata".',
    }
  }

  try {
    const snapshot = await updateSession({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      ...(title !== undefined ? { title } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(signal ? { signal } : {}),
    })
    return {
      success: true,
      output: {
        sessionId: target.sessionId,
        updated: true,
        ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
        ...(snapshot.title ? { title: snapshot.title } : {}),
      },
    }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, updated: false },
      error: getErrorMessage(error, 'Failed to update Managed Agent session'),
    }
  }
}
