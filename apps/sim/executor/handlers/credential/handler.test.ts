import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const hoisted = vi.hoisted(() => ({
  oauth: vi.fn(),
  mcp: vi.fn(),
  workspace: vi.fn(),
}))
vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)
vi.mock('@/lib/credential-groups/application/list-credentials', () => ({
  listCredentialGroupCredentials: { execute: hoisted.oauth },
}))
vi.mock('@/lib/credential-groups/application/list-mcp-connections', () => ({
  listCredentialGroupMcpConnections: { execute: hoisted.mcp },
}))
vi.mock('@/lib/credentials/application/resolve-workflow-credentials', () => ({
  resolveWorkflowCredentials: { execute: hoisted.workspace },
}))

import { CredentialBlockHandler } from '@/executor/handlers/credential/handler'

const mocks = {
  ...hoisted,
  principal: executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext,
}

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
    mocks.principal.mockResolvedValue({ delegationId: 'current-run' })
    mocks.oauth.mockResolvedValue({
      credentials: [{ ...account, accountEmail: 'personal@example.com' }],
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
        limit: 1,
        cursor: undefined,
      },
    })
  })
  it('rejects a missing account', async () => {
    mocks.oauth.mockResolvedValue({ credentials: [], hasMore: false })
    await expect(
      handler.execute(ctx, block, {
        operation: 'find_organization_account',
        email: account.email,
        organizationProvider: 'google-email',
      })
    ).rejects.toThrow('No organization account')
  })
  it('keeps returning the first connected account when a person adds another', async () => {
    mocks.oauth.mockResolvedValue({
      credentials: [
        { ...account, credentialId: 'first', accountEmail: 'first@example.com' },
        { ...account, credentialId: 'added', accountEmail: account.email },
      ],
      hasMore: false,
    })
    expect(
      await handler.execute(ctx, block, {
        operation: 'find_organization_account',
        email: account.email,
        organizationProvider: 'google-email',
      })
    ).toMatchObject({ credentialId: 'first' })
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
          limit: 1,
        }),
      })
    )
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
