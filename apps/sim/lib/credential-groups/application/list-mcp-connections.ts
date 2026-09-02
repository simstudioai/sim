import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveCredentialGroupContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupMcpConnectionCursorNotFoundError,
  type CredentialGroupMcpConnectionReference,
  listCredentialGroupMcpConnectionReferences,
  MAX_CREDENTIAL_GROUP_MCP_CONNECTION_PAGE_SIZE,
} from '@/lib/credential-groups/mcp-connections'

export interface ListCredentialGroupMcpConnectionsInput {
  credentialGroupId: string
  limit: number
  cursor?: string
  email?: string
  mcpServerId?: string
}

export interface ListCredentialGroupMcpConnectionsResult {
  mcpConnections: CredentialGroupMcpConnectionReference[]
  count: number
  hasMore: boolean
  nextCursor: string | null
}

export const listCredentialGroupMcpConnections = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.listMcpConnections,
  resolveContext: ({ input }: { input: ListCredentialGroupMcpConnectionsInput }) =>
    resolveCredentialGroupContext(input.credentialGroupId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  execute: async ({ input, context }): Promise<ListCredentialGroupMcpConnectionsResult> => {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_CREDENTIAL_GROUP_MCP_CONNECTION_PAGE_SIZE
    ) {
      throw new OrchestrationError(
        'validation',
        `Limit must be an integer between 1 and ${MAX_CREDENTIAL_GROUP_MCP_CONNECTION_PAGE_SIZE}`
      )
    }
    if (context.status !== 'active') {
      throw new OrchestrationError('conflict', 'Credential group is disabled')
    }

    const email = input.email ? normalizeEmail(input.email) : undefined
    if (email && !isValidEmailSyntax(email)) {
      throw new OrchestrationError('validation', 'Email must be a valid address')
    }
    const mcpServerId = input.mcpServerId?.trim()
    if (input.mcpServerId !== undefined && !mcpServerId) {
      throw new OrchestrationError('validation', 'MCP server ID must not be empty')
    }

    await requireCredentialGroupsAvailable(context.workspaceId)

    let page
    try {
      page = await listCredentialGroupMcpConnectionReferences({
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        limit: input.limit,
        cursor: input.cursor,
        email,
        mcpServerId,
      })
    } catch (error) {
      if (error instanceof CredentialGroupMcpConnectionCursorNotFoundError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }

    return {
      mcpConnections: page.mcpConnections,
      count: page.mcpConnections.length,
      hasMore: page.nextCursor !== null,
      nextCursor: page.nextCursor,
    }
  },
})
