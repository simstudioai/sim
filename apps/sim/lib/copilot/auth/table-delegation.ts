import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedCopilotPrincipal,
} from '@/lib/copilot/auth/application-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'

export type CopilotTableDelegationContext = CopilotExecutionContext

/** Creates the trusted Table principal used while resolving Copilot chat context. */
export function createCopilotChatTablePrincipal(
  context: { userId: string; workspaceId: string; chatId?: string },
  tableId: string
) {
  return createTrustedCopilotPrincipal(
    { ...context, delegationId: `copilot-chat:${context.chatId ?? context.workspaceId}` },
    {
      audience: tableDelegationPolicy.audience,
      ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
      resourceScope: { tableId },
    }
  )
}

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
