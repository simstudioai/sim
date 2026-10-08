import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { AsyncConfirmationStatus } from '@/lib/mothership/async-runs/lifecycle'

const PAGE_EXIT_COMPLETION_MAX_BYTES = 48 * 1024
interface ClientToolCompletion {
  status: AsyncConfirmationStatus
  message: string
  data?: unknown
}

export function compactCompletionForPageExit(
  toolCallId: string,
  completion: ClientToolCompletion
): ClientToolCompletion {
  const serialized = JSON.stringify({ toolCallId, ...completion })
  if (new Blob([serialized]).size <= PAGE_EXIT_COMPLETION_MAX_BYTES) return completion

  const data = toRecord(completion.data)
  return {
    status: completion.status,
    message: truncate(completion.message, 1024),
    data: {
      ...(data.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
      ...(data.doNotRetry === true ? { doNotRetry: true } : {}),
      ...(data.sessionClosed === true ? { sessionClosed: true } : {}),
      resultOmittedDuringPageExit: true,
      note: 'The action reached a known terminal state, but its full result was too large for unload-safe delivery. Do not repeat a side-effecting action. Take a fresh observation to recover current state.',
    },
  }
}
