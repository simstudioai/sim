import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const PUBLIC_API_PRINCIPAL_KINDS = [
  'personal_api_key',
  'oauth_access_token',
  'workspace_api_key',
] as const
const LOG_READER_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

export const logOperations = {
  // permission-group-exempt: reading the log list is governed by workspace role; the group withholds fields inside a run — trace spans and cost — not the fact that it ran
  list: defineWorkspaceOperation({
    id: 'logs.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...LOG_READER_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: aggregate run counts carry no execution payload, so there is nothing here for a group to withhold
  readStats: defineWorkspaceOperation({
    id: 'logs.read_stats',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  // permission-group-exempt: as with the list, the group projects trace spans and cost out of the response rather than refusing the read
  readDetail: defineWorkspaceOperation({
    id: 'logs.read_detail',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...LOG_READER_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the executor reading its own run's snapshot mid-flight; refusing it would fail runs the group permits
  readExecutionSnapshot: defineWorkspaceOperation({
    id: 'logs.read_execution_snapshot',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['executor'],
  }),
} as const
