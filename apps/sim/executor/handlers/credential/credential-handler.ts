import { CREDENTIAL_GROUP_DELEGATION_AUDIENCE } from '@/lib/credential-groups/application/authorization'
import { listCredentialGroupCredentials } from '@/lib/credential-groups/application/list-credentials'
import { listCredentialGroupMcpConnections } from '@/lib/credential-groups/application/list-mcp-connections'
import { MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE } from '@/lib/credential-groups/credentials'
import { resolveWorkflowCredentials } from '@/lib/credentials/application/resolve-workflow-credentials'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

function parseStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  let parsed: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (!trimmed.startsWith('[')) return [trimmed]
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`${label} must be a valid JSON array of strings`)
    }
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }

  const values = [...new Set(parsed.map((item) => item.trim()))]
  return values.length > 0 ? values : undefined
}

function parseLimit(value: unknown): number {
  const raw = value ?? MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE
  const limit =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE) {
    throw new Error(
      `Limit must be an integer between 1 and ${MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE}`
    )
  }
  return limit
}

function parseOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function requireString(value: unknown, label: string): string {
  const parsed = parseOptionalString(value, label)
  if (!parsed) throw new Error(`${label} is required`)
  return parsed
}

export class CredentialBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CREDENTIAL
  }

  async execute(
    ctx: ExecutionContext,
    _block: SerializedBlock,
    inputs: Record<string, unknown>
  ): Promise<BlockOutput> {
    if (!ctx.workspaceId || !ctx.executorDelegationOrigin)
      throw new Error('Credential operations require an authenticated workflow execution')
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: ctx,
      audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
    })
    const operation = parseOptionalString(inputs.operation, 'Operation') ?? 'select'
    switch (operation) {
      case 'select': {
        const credentials = await resolveWorkflowCredentials.execute({
          principal,
          input: {
            workspaceId: ctx.workspaceId,
            credentialId: requireString(inputs.credentialId, 'Credential ID'),
          },
        })
        const selected = credentials[0]
        if (!selected) throw new Error('Credential not found')
        return selected
      }
      case 'list': {
        const credentials = await resolveWorkflowCredentials.execute({
          principal,
          input: {
            workspaceId: ctx.workspaceId,
            providerIds: parseStringList(inputs.providerFilter, 'Providers'),
          },
        })
        return { credentials, count: credentials.length }
      }
      case 'find_organization_account':
      case 'list_organization_accounts': {
        const find = operation === 'find_organization_account'
        const result = await listCredentialGroupCredentials.execute({
          principal,
          input: {
            workspaceId: ctx.workspaceId,
            email: find
              ? requireString(inputs.email, 'Email')
              : parseOptionalString(inputs.email, 'Email'),
            credentialProviderIds: find
              ? [requireString(inputs.organizationProvider, 'Provider')]
              : parseStringList(inputs.organizationProviders, 'Providers'),
            limit: find ? 2 : parseLimit(inputs.limit),
            cursor: find ? undefined : parseOptionalString(inputs.cursor, 'Cursor'),
          },
        })
        if (!find) return result
        if (result.credentials.length !== 1 || result.hasMore)
          throw new Error(
            `Expected exactly one organization account; found ${result.credentials.length}${result.hasMore ? '+' : ''}. Check the email, provider, and connection status.`
          )
        return result.credentials[0]!
      }
      case 'find_organization_mcp_connection':
      case 'list_organization_mcp_connections': {
        const find = operation === 'find_organization_mcp_connection'
        const result = await listCredentialGroupMcpConnections.execute({
          principal,
          input: {
            workspaceId: ctx.workspaceId,
            email: find
              ? requireString(inputs.email, 'Email')
              : parseOptionalString(inputs.email, 'Email'),
            connectorId: find
              ? requireString(inputs.mcpProvider, 'MCP provider')
              : parseOptionalString(inputs.mcpProvider, 'MCP provider'),
            limit: find ? 2 : parseLimit(inputs.limit),
            cursor: find ? undefined : parseOptionalString(inputs.cursor, 'Cursor'),
          },
        })
        if (!find) return result
        if (result.mcpConnections.length !== 1 || result.hasMore)
          throw new Error(
            `Expected exactly one organization MCP connection; found ${result.mcpConnections.length}${result.hasMore ? '+' : ''}. Check the email, provider, and connection status.`
          )
        return result.mcpConnections[0]!
      }
      default:
        throw new Error(`Unsupported Credential operation: ${operation}`)
    }
  }
}
