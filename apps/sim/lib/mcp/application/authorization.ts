import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const MCP_SERVER_DELEGATION_AUDIENCE = 'sim:mcp-servers'

export const mcpServerDelegationPolicy = {
  audience: MCP_SERVER_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
