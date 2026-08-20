import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import {
  type AccountBillingSnapshot,
  getAccountBillingSnapshot,
} from '@/lib/billing/core/account-billing-snapshot'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { platformContextDelegationPolicy } from '@/lib/platform-context/application/authorization'
import { resolvePlatformContextWorkspace } from '@/lib/platform-context/application/context'
import { platformContextOperations } from '@/lib/platform-context/application/operations'

export interface ReadAccountBillingInput {
  workspaceId: string
}

export const readAccountBilling = defineAuthorizedWorkspaceUseCase({
  operation: platformContextOperations.readAccountBilling,
  resolveContext: ({ input }: { input: ReadAccountBillingInput }) =>
    resolvePlatformContextWorkspace(input.workspaceId),
  authorizationOptions: { delegation: platformContextDelegationPolicy },
  execute: async ({ principal }): Promise<AccountBillingSnapshot> =>
    getAccountBillingSnapshot(requirePrincipalSubjectUserId(principal)),
})
