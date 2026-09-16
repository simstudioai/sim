/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  oauth: vi.fn(),
  mcp: vi.fn(),
  workspace: vi.fn(),
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@/lib/credential-groups/application/list-credentials', () => ({
  listCredentialGroupCredentials: { execute: mocks.oauth },
}))
vi.mock('@/lib/credential-groups/application/list-mcp-connections', () => ({
  listCredentialGroupMcpConnections: { execute: mocks.mcp },
}))
vi.mock('@/lib/credentials/application/resolve-workflow-credentials', () => ({
  resolveWorkflowCredentials: { execute: mocks.workspace },
}))

import { CredentialBlockHandler } from '@/executor/handlers/credential/credential-handler'

const ctx = {
  workspaceId: 'child-workspace',
  executorDelegationOrigin: { workflowId: 'child-workflow' },
} as ExecutionContext
const block = { metadata: { id: 'credential' } } as SerializedBlock
const handler = new CredentialBlockHandler()
const account = {
  credentialId: 'credential-1',
  email: 'person@example.com',
  providerId: 'google-email',
  displayName: 'Person',
}

describe('Credential organization operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.principal.mockResolvedValue({ delegationId: 'current-run' })
    mocks.oauth.mockResolvedValue({
      credentials: [account],
      count: 1,
      hasMore: false,
      nextCursor: null,
    })
  })
  it('uses the actual executing workspace for an exact account lookup', async () => {
    expect(
      await handler.execute(ctx, block, {
        operation: 'find_organization_account',
        email: account.email,
        organizationProvider: 'google-email',
      })
    ).toEqual(account)
    expect(mocks.oauth).toHaveBeenCalledWith({
      principal: { delegationId: 'current-run' },
      input: {
        workspaceId: 'child-workspace',
        email: account.email,
        credentialProviderIds: ['google-email'],
        limit: 2,
        cursor: undefined,
      },
    })
  })
  it.each([0, 2])('rejects an ambiguous or missing account (%i matches)', async (count) => {
    mocks.oauth.mockResolvedValue({
      credentials: Array.from({ length: count }, () => account),
      hasMore: false,
    })
    await expect(
      handler.execute(ctx, block, {
        operation: 'find_organization_account',
        email: account.email,
        organizationProvider: 'google-email',
      })
    ).rejects.toThrow('Expected exactly one')
  })
  it('requires both email and provider for find', async () => {
    await expect(
      handler.execute(ctx, block, { operation: 'find_organization_account', email: account.email })
    ).rejects.toThrow('Provider is required')
    expect(mocks.oauth).not.toHaveBeenCalled()
  })
  it('preserves pagination for lists', async () => {
    await handler.execute(ctx, block, {
      operation: 'list_organization_accounts',
      limit: '25',
      cursor: 'previous',
      organizationProviders: '["google-email"]',
    })
    expect(mocks.oauth).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          limit: 25,
          cursor: 'previous',
          credentialProviderIds: ['google-email'],
        }),
      })
    )
  })
  it('returns the person’s MCP credential separately from the shared server', async () => {
    const connection = {
      credentialId: 'mcp-cg-person',
      mcpServerId: 'server',
      toolNames: ['search'],
    }
    mocks.mcp.mockResolvedValue({ mcpConnections: [connection], hasMore: false })
    expect(
      await handler.execute(ctx, block, {
        operation: 'find_organization_mcp_connection',
        email: account.email,
        mcpProvider: 'fireflies',
      })
    ).toEqual(connection)
    expect(mocks.mcp).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          connectorId: 'fireflies',
          email: account.email,
          limit: 2,
        }),
      })
    )
  })
  it('preserves workspace credential selection through its authorized use case', async () => {
    mocks.workspace.mockResolvedValue([account])
    expect(
      await handler.execute(ctx, block, { operation: 'select', credentialId: 'credential-1' })
    ).toEqual(account)
    expect(mocks.oauth).not.toHaveBeenCalled()
  })
  it.each(['send_invite', 'get_invite_link', 'list_people'])(
    'does not expose the removed %s operation',
    async (operation) => {
      await expect(handler.execute(ctx, block, { operation })).rejects.toThrow(
        'Unsupported Credential operation'
      )
    }
  )
  it('requires trusted workflow execution', async () => {
    await expect(
      handler.execute({ workspaceId: 'workspace' } as ExecutionContext, block, {
        operation: 'list_organization_accounts',
      })
    ).rejects.toThrow('authenticated workflow execution')
    expect(mocks.principal).not.toHaveBeenCalled()
  })
})
