import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const selectorOperations = {
  // permission-group-exempt: no static capability names selector browsing — credential access is authorized per credential, and per-integration denial is the parameterized allowedIntegrations key, which the funnel cannot apply because it never sees which integration a selector reaches. That decision is enforced from the use case by assertSelectorIntegrationAllowed, against the selector's own resource, ahead of the provider call.
  execute: defineWorkspaceOperation({
    id: 'selectors.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const
