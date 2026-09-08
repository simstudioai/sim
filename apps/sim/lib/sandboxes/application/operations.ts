import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * Every operation declares `sandboxes.use`, reads included: a group that
 * withholds the module has no use for its listing either.
 *
 * Reads sit at `read` and are not plan-gated. A workspace that dropped below
 * the Max tier must still see what it built, and the list carries `entitled`
 * so a surface knows whether authoring will be refused. Writes are `admin`,
 * because builds cost provider compute, and the admin ceiling is also what
 * denies workspace API keys: the write use cases resolve the acting human as
 * the sandbox's creator, which a workspace key cannot supply.
 */
export const sandboxOperations = {
  list: defineWorkspaceOperation({
    id: 'sandboxes.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'sandboxes.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'sandboxes.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'sandboxes.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'sandboxes.create',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'sandboxes.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'sandboxes.update',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'sandboxes.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'sandboxes.delete',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'sandboxes.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
} as const

export type SandboxOperation = (typeof sandboxOperations)[keyof typeof sandboxOperations]
