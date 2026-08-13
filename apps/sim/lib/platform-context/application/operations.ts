import { defineWorkspaceOperation } from '@/lib/core/application'

const LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

export const platformContextOperations = {
  readAccountBilling: defineWorkspaceOperation({
    id: 'platform_context.account_billing.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY,
  }),
  readEnterpriseContext: defineWorkspaceOperation({
    id: 'platform_context.enterprise.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    ...LIVE_PLATFORM_CONTEXT_PRINCIPAL_POLICY,
  }),
} as const

export type PlatformContextOperation =
  (typeof platformContextOperations)[keyof typeof platformContextOperations]
