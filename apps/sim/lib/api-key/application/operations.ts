import { defineWorkspaceOperation } from '@/lib/core/application'

export const apiKeyOperations = {
  createFromCopilot: defineWorkspaceOperation({
    id: 'api_keys.copilot.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

export type ApiKeyOperation = (typeof apiKeyOperations)[keyof typeof apiKeyOperations]
