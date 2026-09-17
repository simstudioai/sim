/** @vitest-environment node */
import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  INTEGRATION_CATALOG_AUDIENCE,
  projectIntegrationCatalog,
  readIntegrationCatalog,
} from '@/lib/mothership/integrations/application/catalog'

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  mcp: vi.fn(),
  config: vi.fn(),
  banned: vi.fn(),
  target: vi.fn(),
  workspace: vi.fn(),
  listServers: vi.fn(),
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  listMcpServersUseCase: { execute: mocks.listServers },
}))
vi.mock('@/lib/mothership/chat/payload', () => ({ buildIntegrationToolSchemas: mocks.build }))
vi.mock('@/lib/mothership/mcp-tools', () => ({ buildTaggedMcpToolSchemas: mocks.mcp }))
vi.mock('@/lib/mothership/application/workspace-target', () => ({
  resolveInvocationWorkspace: mocks.target,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))

const input = { mode: 'assistant' as const, mcpServerIds: [], limit: 20 }
const tools = [
  {
    name: 'gmail_send',
    service: 'gmail',
    description: 'Send email',
    input_schema: { type: 'object' },
  },
  {
    name: 'slack_send',
    service: 'slack',
    description: 'Send message',
    input_schema: { type: 'object' },
  },
]
function principal() {
  return createTrustedOrganizationCopilotPrincipal(
    { userId: 'actor', organizationId: 'org-1', chatId: 'chat-1', delegationId: 'catalog-1' },
    { audience: INTEGRATION_CATALOG_AUDIENCE, ttlMs: 60_000 }
  )
}
function queueChat(mode = 'assistant', role = 'member') {
  queueTableRows(copilotChats, [
    { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership', mode },
  ])
  queueTableRows(member, role ? [{ role }] : [])
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.banned.mockResolvedValue([])
  mocks.config.mockResolvedValue(null)
  mocks.build.mockResolvedValue([...tools])
  mocks.mcp.mockResolvedValue([])
  mocks.listServers.mockResolvedValue({ servers: [{ id: 'mcp-abc' }] })
})
describe('integration catalog projection', () => {
  it('omits schemas from broad listings and treats zero as an explicit full listing', () => {
    expect(projectIntegrationCatalog(tools, { ...input, limit: 1 })).toEqual({
      total: 2,
      truncated: true,
      operations: [{ toolId: 'gmail_send', service: 'gmail', description: 'Send email' }],
    })
    expect(projectIntegrationCatalog(tools, { ...input, limit: 0 })).toMatchObject({
      total: 2,
      truncated: false,
    })
    expect(projectIntegrationCatalog(tools, { ...input, limit: 0 }).operations).toHaveLength(2)
  })
  it('returns schemas only for matching query or exact ID and never guesses unknown tools', () => {
    expect(
      projectIntegrationCatalog(tools, { ...input, query: 'email' }).operations[0]?.inputSchema
    ).toEqual({ type: 'object' })
    expect(
      projectIntegrationCatalog(tools, { ...input, toolId: 'gmail_send' }).operations
    ).toHaveLength(1)
    expect(
      projectIntegrationCatalog(tools, { ...input, toolId: 'gmail_delete' }).operations
    ).toEqual([])
    expect(
      projectIntegrationCatalog(tools, { ...input, service: 'gmail' }).operations[0]
    ).not.toHaveProperty('inputSchema')
  })
})
describe('catalog authorization', () => {
  it('preserves assistant personal-account and organization-approval projection and excludes MCP', async () => {
    queueChat()
    await readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mcpServerIds: ['mcp-abc'] },
    })
    expect(mocks.build).toHaveBeenCalledWith(
      'actor',
      { schemaSurface: 'copilot', personalAccountsOnly: true, organizationId: 'org-1' },
      undefined
    )
    expect(mocks.mcp).not.toHaveBeenCalled()
  })
  it.each(['user', 'organization', 'expired', 'audience', 'mode', 'membership'] as const)(
    'rejects invalid %s before catalog building',
    async (field) => {
      queueChat('assistant', field === 'membership' ? '' : 'member')
      const caller = {
        ...principal(),
        ...(field === 'user' ? { subjectUserId: 'other' } : {}),
        ...(field === 'organization' ? { organizationId: 'other' } : {}),
        ...(field === 'expired' ? { expiresAt: new Date(0) } : {}),
        ...(field === 'audience' ? { audience: 'wrong' } : {}),
      }
      await expect(
        readIntegrationCatalog.execute({
          principal: caller,
          input: { ...input, ...(field === 'mode' ? { mode: 'agent' as const } : {}) },
        })
      ).rejects.toThrow()
      expect(mocks.build).not.toHaveBeenCalled()
    }
  )
  it('rejects workspace scope substitution before loading the requested workspace', async () => {
    const caller = createTrustedCopilotPrincipal(
      { userId: 'actor', workspaceId: 'workspace-1', delegationId: 'catalog-1' },
      { audience: INTEGRATION_CATALOG_AUDIENCE, ttlMs: 60_000 }
    )
    await expect(
      readIntegrationCatalog.execute({
        principal: caller,
        input: { ...input, workspaceId: 'workspace-2' },
      })
    ).rejects.toThrow('Workspace not found')
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('requires current target authorization for organization workspace discovery', async () => {
    queueChat('agent')
    mocks.target.mockRejectedValue(new Error('Workspace grant revoked'))
    await expect(
      readIntegrationCatalog.execute({
        principal: principal(),
        input: { ...input, mode: 'agent', workspaceId: 'workspace-1' },
      })
    ).rejects.toThrow('Workspace grant revoked')
    expect(mocks.build).not.toHaveBeenCalled()
  })
})

it('exposes selected MCP operations without enabling sibling operations', async () => {
  queueChat('agent')
  mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
  mocks.mcp.mockResolvedValue([
    { name: 'mcp-abc-read', service: 'mcp:mcp-abc', description: 'Read', input_schema: {} },
    { name: 'mcp-abc-write', service: 'mcp:mcp-abc', description: 'Write', input_schema: {} },
  ])
  const result = await readIntegrationCatalog.execute({
    principal: principal(),
    input: {
      ...input,
      mode: 'agent',
      workspaceId: 'workspace-1',
      mcpToolIds: ['mcp-abc-read'],
      service: 'mcp:mcp-abc',
    },
  })
  expect(mocks.mcp).toHaveBeenCalledWith('actor', 'workspace-1', ['mcp-abc'], undefined)
  expect(result.operations.map((operation) => operation.toolId)).toEqual(['mcp-abc-read'])
})
it('keeps native discovery available in organization chats with tagged MCP servers', async () => {
  queueChat('agent')
  const result = await readIntegrationCatalog.execute({
    principal: principal(),
    input: { ...input, mode: 'agent', mcpServerIds: ['mcp-abc'], toolId: 'gmail_send' },
  })
  expect(result.operations.map((operation) => operation.toolId)).toEqual(['gmail_send'])
  expect(mocks.mcp).not.toHaveBeenCalled()
})
it('requires an explicit workspace target for organization MCP discovery', async () => {
  queueChat('agent')
  await expect(
    readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode: 'agent', mcpServerIds: ['mcp-abc'], toolId: 'mcp-abc-read' },
    })
  ).rejects.toThrow('explicit workspace ID')
  expect(mocks.mcp).not.toHaveBeenCalled()
})

it('ranks query tokens across operation names, descriptions, and service while prioritizing exact IDs', () => {
  expect(
    projectIntegrationCatalog(tools, { ...input, query: 'gmail send email' }).operations[0]?.toolId
  ).toBe('gmail_send')
  const ranked = [
    ...tools,
    {
      name: 'gmail_send_more',
      service: 'gmail',
      description: 'gmail send gmail send',
      input_schema: {},
    },
  ]
  expect(
    projectIntegrationCatalog(ranked, { ...input, query: 'gmail_send' }).operations[0]?.toolId
  ).toBe('gmail_send')
  const large = Array.from({ length: 130 }, (_, index) => ({
    name: `tool_${index}`,
    description: 'search',
    input_schema: {},
  }))
  expect(
    projectIntegrationCatalog(large, { ...input, query: 'search', limit: 130 }).operations
  ).toHaveLength(130)
})

it('filters organization enabled servers to the authorized target before broad MCP discovery', async () => {
  queueChat('agent')
  mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
  mocks.listServers.mockResolvedValue({ servers: [{ id: 'mcp-abc' }] })
  await readIntegrationCatalog.execute({
    principal: principal(),
    input: {
      ...input,
      mode: 'agent',
      workspaceId: 'workspace-1',
      mcpServerIds: ['mcp-abc', 'mcp-otherworkspace'],
    },
  })
  expect(mocks.listServers).toHaveBeenCalledWith({
    principal: expect.objectContaining({ workspaceId: 'workspace-1', subjectUserId: 'actor' }),
    input: { workspaceId: 'workspace-1' },
  })
  expect(mocks.mcp).toHaveBeenCalledWith('actor', 'workspace-1', ['mcp-abc'], undefined)
})
