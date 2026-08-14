import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import type { CopilotExecutionContext } from '@/lib/copilot/auth/application-delegation'

export type CopilotTableDelegationContext = CopilotExecutionContext

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
