import { defineWorkspaceOperation } from '@/lib/core/application'

const PUBLIC_API_PRINCIPAL_KINDS = ['personal_api_key', 'workspace_api_key'] as const
const LOG_READER_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

export const logOperations = {
  list: defineWorkspaceOperation({
    id: 'logs.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...LOG_READER_PRINCIPAL_POLICY,
  }),
  readStats: defineWorkspaceOperation({
    id: 'logs.read_stats',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  readDetail: defineWorkspaceOperation({
    id: 'logs.read_detail',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...LOG_READER_PRINCIPAL_POLICY,
  }),
  readExecutionSnapshot: defineWorkspaceOperation({
    id: 'logs.read_execution_snapshot',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['executor'],
  }),
} as const
