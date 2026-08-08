import { defineWorkspaceOperation } from '@/lib/core/application'

const PUBLIC_API_PRINCIPAL_KINDS = ['personal_api_key', 'workspace_api_key'] as const

export const workspaceOperations = {
  readPublicDetail: defineWorkspaceOperation({
    id: 'workspaces.read_public_detail',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  listPublicMembers: defineWorkspaceOperation({
    id: 'workspaces.members.list_public',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
} as const
