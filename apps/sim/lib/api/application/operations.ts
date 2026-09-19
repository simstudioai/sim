import { defineOperation } from '@/lib/core/application/operation'

/**
 * Operations a credential performs on itself.
 *
 * They carry no workspace scope and no role: the resource *is* the
 * authenticated key, so holding it is the whole authorization story. What is
 * left — which kinds of principal may hold that resource — is declared here as
 * data through {@link defineOperation}, so the policy is inspectable rather
 * than hand-rolled inside the use case.
 */
export const v2MetaOperations = {
  // permission-group-exempt: the resource is the API key the caller already proved it holds, and reporting what that key can do withholds nothing a group could
  read: defineOperation({
    id: 'meta.capabilities.read',
    oauthScope: 'api:read',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const

/**
 * Connecting to the Sim MCP server. Admission only: every tool call is then a v2
 * operation of its own, authorized and rate-limited by its route exactly as the
 * same request over HTTP would be.
 */
export const v2McpOperations = {
  // permission-group-exempt: connecting reveals only the static catalog of v2 operations; each tool call is its own v2 operation and enforces that operation's capability
  connect: defineOperation({
    id: 'mcp.api.connect',
    oauthScope: 'api:read',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  /**
   * The scope a tool call needs when it runs a raw v2 route, which declares no
   * operation of its own (chat, workflow execution, resume); each changes
   * something. Declared-operation routes are checked against their own scope.
   */
  // permission-group-exempt: a scope gate only; the dispatched v2 route enforces its own capability
  rawRoute: defineOperation({
    id: 'mcp.api.raw-route',
    oauthScope: 'api:write',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const
