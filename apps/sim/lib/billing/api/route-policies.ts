import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'

/**
 * Billing reads are workspace-scoped, so a caller naming a workspace it cannot
 * reach must not be able to tell that refusal apart from a workspace that does
 * not exist. Both answer `404 "Workspace not found"`, which is the message the
 * unknown-workspace path already uses.
 */
export const v2BillingErrorPolicies = {
  concealWorkspaceAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
  }),
} as const
