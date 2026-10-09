import { omit, toRecord } from '@sim/utils/object'
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
  const fits = (value: ClientToolCompletion) =>
    new Blob([JSON.stringify({ toolCallId, ...value })]).size <= PAGE_EXIT_COMPLETION_MAX_BYTES
  if (fits(completion)) return completion

  const data = toRecord(completion.data)
  const compact = {
    ...completion,
    message: truncate(completion.message, 1024),
    data: {
      ...omit(data, ['observations']),
      resultOmittedDuringPageExit: true,
      note: 'The result was compacted for unload-safe delivery. Inspect current state without repeating input.',
    },
  }
  if (fits(compact)) return compact
  return {
    ...compact,
    data: {
      ...(data.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
      ...(data.doNotRetry === true ? { doNotRetry: true } : {}),
      ...(data.sessionClosed === true ? { sessionClosed: true } : {}),
      resultOmittedDuringPageExit: true,
      note: 'The full result was too large for unload-safe delivery. Do not repeat a side-effecting action. Take a fresh observation to recover current state.',
    },
  }
}
