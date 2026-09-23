/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  listKeys: vi.fn(),
  getKey: vi.fn(),
  decrypt: vi.fn(),
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

vi.mock('@/lib/credential-groups/application/api-keys', () => ({
  listCredentialGroupApiKeys: { execute: mocks.listKeys },
  getCredentialGroupApiKey: { execute: mocks.getKey },
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))

import { CredentialBlockHandler } from '@/executor/handlers/credential/credential-handler'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
  it('discovers provider emails across pages without requiring an enrollment email', async () => {
    const accounts = [
      { ...account, accountEmail: 'first@example.com' },
      { ...account, credentialId: 'credential-2', accountEmail: 'second@example.com' },
      {
        ...account,
        credentialId: 'credential-3',
        email: 'colleague@example.com',
        accountEmail: 'third@example.com',
      },
    ]
    mocks.oauth
      .mockResolvedValueOnce({
        credentials: accounts.slice(0, 2),
        count: 2,
        hasMore: true,
        nextCursor: 'credential-2',
      })
      .mockResolvedValueOnce({
        credentials: accounts.slice(2),
        count: 1,
        hasMore: false,
        nextCursor: null,
      })
    const input = {
      operation: 'list_organization_accounts',
      organizationProviders: ['google-email'],
      limit: 2,
    }
    const first = await handler.execute(ctx, block, input)
    const second = await handler.execute(ctx, block, { ...input, cursor: first.nextCursor })
    expect(first).toMatchObject({
      credentials: accounts.slice(0, 2),
      emails: ['first@example.com', 'second@example.com'],
      count: 2,
      hasMore: true,
    })
    expect(second).toMatchObject({
      credentials: accounts.slice(2),
      emails: ['third@example.com'],
      hasMore: false,
      nextCursor: null,
    })
    expect(mocks.oauth).toHaveBeenLastCalledWith({
      principal: { delegationId: 'current-run' },
      input: {
        workspaceId: 'child-workspace',
        email: undefined,
        credentialProviderIds: ['google-email'],
        limit: 2,
        cursor: 'credential-2',
      },
    })
  })
  it('preserves the optional exact enrollment-email filter for organization lists', async () => {
    await handler.execute(ctx, block, {
      operation: 'list_organization_accounts',
      organizationProviders: ['google-email'],
      email: 'person@example.com',
    })
    expect(mocks.oauth).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ email: 'person@example.com' }) })
    )
  })
  it('returns empty email and account arrays when no accessible accounts match', async () => {
    mocks.oauth.mockResolvedValue({ credentials: [], count: 0, hasMore: false, nextCursor: null })
    await expect(
      handler.execute(ctx, block, {
        operation: 'list_organization_accounts',
        organizationProviders: ['google-email'],
      })
    ).resolves.toEqual({
      credentials: [],
      emails: [],
      count: 0,
      hasMore: false,
      nextCursor: null,
    })
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

describe('Credential API key operations', () => {
  const metadata = {
    credentialId: 'key-1',
    optionId: 'option-1',
    name: 'Exa API key',
    email: 'contributor@example.com',
  }
  const secret = 'test-provider-api-key'
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.principal.mockResolvedValue({ delegationId: 'current-run' })
    mocks.getKey.mockResolvedValue({ ...metadata, encryptedValue: 'ciphertext', apiKey: secret })
    mocks.decrypt.mockResolvedValue({ decrypted: secret })
  })
  it('lists IDs and metadata using dynamic filters without resolving a secret', async () => {
    const page = { apiKeys: [metadata], count: 1, hasMore: false, nextCursor: null }
    mocks.listKeys.mockResolvedValue(page)
    expect(
      await handler.execute(ctx, block, {
        operation: 'list_credential_group_api_keys',
        keyName: 'Exa API key',
        email: 'contributor@example.com',
        limit: '25',
      })
    ).toEqual(page)
    expect(mocks.listKeys).toHaveBeenCalledWith({
      principal: { delegationId: 'current-run' },
      input: {
        workspaceId: 'child-workspace',
        keyName: 'Exa API key',
        email: 'contributor@example.com',
        limit: 25,
        cursor: undefined,
      },
    })
    expect(mocks.getKey).not.toHaveBeenCalled()
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
  it('registers anonymous encrypted provenance before returning a usable key', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const result = await handler.execute({ ...ctx, resolvedSecretTraceRegistry: registry }, block, {
      operation: 'get_credential_group_api_key',
      apiKeyCredentialId: 'key-1',
    })
    expect(result).toEqual({ ...metadata, apiKey: secret })
    expect(result).not.toHaveProperty('encryptedValue')
    expect(
      projectResolvedSecretModelContent({ authorization: `Bearer ${secret}` }, registry)
    ).toEqual({ safe: true, value: { authorization: 'Bearer [REDACTED_SECRET]' } })
    const provenance = registry.exportCommittedProvenanceForValue(result)
    expect(provenance).toMatchObject({
      complete: true,
      entries: [{ encryptedValue: 'ciphertext' }],
    })
    expect(JSON.stringify(provenance)).not.toContain(secret)
    const downstream = new ResolvedSecretTraceRegistry()
    await downstream.importProvenance(provenance, { trusted: true })
    expect(projectResolvedSecretModelContent(secret, downstream)).toEqual({
      safe: true,
      value: '[REDACTED_SECRET]',
    })
  })
  it('fails before retrieval without complete provenance or an explicit credential ID', async () => {
    await expect(
      handler.execute(ctx, block, {
        operation: 'get_credential_group_api_key',
        apiKeyCredentialId: 'key-1',
      })
    ).rejects.toThrow('complete secret provenance')
    const registry = new ResolvedSecretTraceRegistry()
    await expect(
      handler.execute({ ...ctx, resolvedSecretTraceRegistry: registry }, block, {
        operation: 'get_credential_group_api_key',
      })
    ).rejects.toThrow('Credential ID is required')
    registry.markIncomplete('unspecified')
    await expect(
      handler.execute({ ...ctx, resolvedSecretTraceRegistry: registry }, block, {
        operation: 'get_credential_group_api_key',
        apiKeyCredentialId: 'key-1',
      })
    ).rejects.toThrow('complete secret provenance')
    expect(mocks.getKey).not.toHaveBeenCalled()
  })
  it('does not release the key if provenance decryption fails', async () => {
    mocks.decrypt.mockRejectedValue(new Error('Cannot decrypt'))
    const registry = new ResolvedSecretTraceRegistry()
    await expect(
      handler.execute({ ...ctx, resolvedSecretTraceRegistry: registry }, block, {
        operation: 'get_credential_group_api_key',
        apiKeyCredentialId: 'key-1',
      })
    ).rejects.toThrow('registered for secret redaction')
    expect(registry.isComplete()).toBe(false)
  })
})
