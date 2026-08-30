import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'

export type CopilotTableDelegationContext = CopilotExecutionContext

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
