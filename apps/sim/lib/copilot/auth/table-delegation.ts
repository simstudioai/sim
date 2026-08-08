import type { DelegatedPrincipal } from '@sim/auth/principal'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'

export type CopilotTableDelegationContext = CopilotExecutionContext

/** Normalizes trusted Copilot execution context into the shared table principal. */
export function resolveCopilotTablePrincipal(
  context: CopilotTableDelegationContext | undefined,
  tableId?: string
): DelegatedPrincipal {
  return createCopilotApplicationPrincipal(requireTrustedCopilotExecutionContext(context), {
    audience: tableDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (trustedContext) => `copilot-tool:${trustedContext.toolCallId}`,
    resourceScope: tableId ? { tableId } : undefined,
  })
}

export function messageForCopilotTableError(
  error: unknown,
  fallback = 'Table operation failed'
): string {
  return messageForCopilotApplicationError(error, fallback)
}
