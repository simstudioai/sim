import { defineWorkspaceOperation } from '@/lib/core/application'

export const selectorOperations = {
  // permission-group-exempt: no static capability names selector browsing — credential access is authorized per credential, and per-integration denial is the parameterized allowedIntegrations key, enforced today at workflow save and execution. Gating the picker itself needs a selector-key-to-block-type mapping and is tracked as a follow-up, not silently covered here.
  execute: defineWorkspaceOperation({
    id: 'selectors.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const
