import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * What Sim reads about itself before it can answer at all: the workspace's plan,
 * its seat and usage state, and whether the organization is on the enterprise
 * tier. No permission-group key names them, and a member whose group withheld
 * them would get an agent that cannot tell them why anything is unavailable —
 * withholding the description of a restriction is not the same as applying one.
 */
export const platformContextOperations = {
  // permission-group-exempt: the plan and usage state every answer is framed against; withholding it blanks the agent rather than restricting it
  readAccountBilling: defineWorkspaceOperation({
    id: 'platform_context.account_billing.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reports which enterprise features the organization has, the frame the restrictions themselves are described in
  readEnterpriseContext: defineWorkspaceOperation({
    id: 'platform_context.enterprise.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY,
  }),
} as const

export type PlatformContextOperation =
  (typeof platformContextOperations)[keyof typeof platformContextOperations]
