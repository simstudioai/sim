import { defineWorkspaceOperation } from '@/lib/core/application'

const PUBLIC_API_PRINCIPAL_KINDS = ['personal_api_key', 'workspace_api_key'] as const

export const workspaceOperations = {
  // permission-group-exempt: the public API's own view of the workspaces a key can reach; it answers what that credential already proves, and `disablePublicApi` governs whether the key reaches the surface at all
  listPublic: defineWorkspaceOperation({
    id: 'workspaces.list_public',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  // permission-group-exempt: the same surface as the list, describing one workspace the key already reaches
  readPublicDetail: defineWorkspaceOperation({
    id: 'workspaces.read_public_detail',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  // permission-group-exempt: names of people the caller already shares a workspace with; `hideOrgMemberDirectory` covers the organization-wide roster and its email addresses, which is the materially different disclosure
  listPublicMembers: defineWorkspaceOperation({
    id: 'workspaces.members.list_public',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
} as const
