import { defineWorkspaceOperation } from '@/lib/core/application'

const PUBLIC_API_PRINCIPAL_KINDS = ['personal_api_key', 'workspace_api_key'] as const

export const logOperations = {
  list: defineWorkspaceOperation({
    id: 'logs.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  readDetail: defineWorkspaceOperation({
    id: 'logs.read_detail',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
} as const
