import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import {
  type CopilotExecutionContext,
  createCopilotChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'

export type CopilotTableDelegationContext = CopilotExecutionContext

/** Creates the trusted Table principal used while resolving Copilot chat context. */
export function createCopilotChatTablePrincipal(
  context: { userId: string; workspaceId: string; chatId?: string },
  tableId: string
) {
  return createCopilotChatPrincipal(context, tableDelegationPolicy.audience, { tableId })
}

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
