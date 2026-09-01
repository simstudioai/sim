import { defineWorkspaceOperation } from '@/lib/core/application'

const HUMAN_API_PRINCIPAL_KINDS = ['session', 'personal_api_key'] as const

export const secretOperations = {
  list: defineWorkspaceOperation({
    id: 'secrets.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  set: defineWorkspaceOperation({
    id: 'secrets.set',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'secrets.delete',
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
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'secrets.manage',
    principalKinds: HUMAN_API_PRINCIPAL_KINDS,
  }),
} as const

export type SecretOperation = (typeof secretOperations)[keyof typeof secretOperations]
