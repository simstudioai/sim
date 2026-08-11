import { defineWorkspaceOperation } from '@/lib/core/application'

const HUMAN_API_PRINCIPAL_KINDS = ['session', 'personal_api_key'] as const

export const secretOperations = {
  list: defineWorkspaceOperation({
    id: 'secrets.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  set: defineWorkspaceOperation({
    id: 'secrets.set',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'secrets.delete',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
} as const

export type SecretOperation = (typeof secretOperations)[keyof typeof secretOperations]
