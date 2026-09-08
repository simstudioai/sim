import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const HUMAN_API_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'oauth_access_token'] as const

export const secretOperations = {
  list: defineWorkspaceOperation({
    id: 'secrets.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  set: defineWorkspaceOperation({
    id: 'secrets.set',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'secrets.delete',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  /**
   * Reading a secret's usage trail names who ran what with it. The use case narrows this to
   * the same people who may read the value itself; the operation only sets the floor.
   */
  usage: defineWorkspaceOperation({
    id: 'secrets.usage',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  /**
   * Reading where a secret is wired in names workflows, blocks, and the tools and servers that
   * carry it — the same shape of disclosure as {@link usage}, so it takes the same floor and
   * the same narrowing in the use case.
   */
  references: defineWorkspaceOperation({
    id: 'secrets.references',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
} as const

export type SecretOperation = (typeof secretOperations)[keyof typeof secretOperations]
