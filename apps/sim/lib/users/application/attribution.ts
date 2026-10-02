import { bindFreebuffAttribution, bindFreebuffHandoff } from '@/lib/analytics/freebuff-agentic'
import type { OperationUseCase } from '@/lib/core/application'
import { requireUserAccountPrincipal } from '@/lib/users/application/authorization'
import { userAccountOperations } from '@/lib/users/application/operations'

/** Attribution can bind only to the authenticated first-party session's own account. */
export const bindAccountAttribution: OperationUseCase<
  typeof userAccountOperations.bindAttribution,
  { sealed: string },
  void
> = {
  operation: userAccountOperations.bindAttribution,
  async execute({ principal, input }) {
    requireUserAccountPrincipal(principal, userAccountOperations.bindAttribution)
    await bindFreebuffAttribution(principal.userId, input.sealed)
  },
}

/** Called after the CLI approval adapter has authorized the human's explicit approval. */
export const bindApprovedCliAttribution: OperationUseCase<
  typeof userAccountOperations.bindAttribution,
  { requestId: string; challenge: string },
  void
> = {
  operation: userAccountOperations.bindAttribution,
  async execute({ principal, input }) {
    requireUserAccountPrincipal(principal, userAccountOperations.bindAttribution)
    await bindFreebuffHandoff(principal.userId, input.requestId, input.challenge)
  },
}
