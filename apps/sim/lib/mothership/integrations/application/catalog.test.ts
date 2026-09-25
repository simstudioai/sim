import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { IntegrationCatalogRequest } from '@/lib/mothership/generated/integration-catalog'
import {
  INTEGRATION_CATALOG_AUDIENCE,
  projectIntegrationCatalog,
  readIntegrationCatalog,
} from '@/lib/mothership/integrations/application/catalog'

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  flag: vi.fn(async () => true),
  mcp: vi.fn(),
  config: vi.fn(),
  banned: vi.fn(),
  target: vi.fn(),
  workspace: vi.fn(),
  listServers: vi.fn(),
}))
vi.mock('@/lib/mothership/feature-flags', () => ({ isSearchIntegrationToolsEnabled: mocks.flag }))
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
  resetDbChainMock()
  mocks.flag.mockResolvedValue(true)
  mocks.banned.mockResolvedValue([])
  mocks.config.mockResolvedValue(null)
  mocks.build.mockResolvedValue([...tools])
  mocks.mcp.mockResolvedValue([])
  mocks.listServers.mockResolvedValue({ servers: [{ id: 'mcp-abc' }] })
})
describe('integration catalog projection', () => {
  it.each(['google_calendar', 'google-calendar', 'Google Calendar', ' GOOGLE-CALENDAR '])(
    'resolves the registered Calendar service name %s without changing the operation',
    (service) => {
      const calendar = {
        name: 'google_calendar_list_v2',
        service: 'google_calendar',
        description: 'List calendar events',
        input_schema: { type: 'object', properties: { calendarId: { type: 'string' } } },
      }
      expect(projectIntegrationCatalog([calendar], { ...input, service, query: 'events' })).toEqual(
        projectIntegrationCatalog([calendar], {
          ...input,
          service: 'google_calendar',
          query: 'events',
        })
      )
      expect(
        projectIntegrationCatalog([calendar], { ...input, service, query: 'events' }).operations
      ).toHaveLength(1)
    }
  )

  it.each([
    ['google-email', 'gmail'],
    ['github-repositories', 'github'],
    ['Microsoft Teams', 'microsoft_teams'],
    ['microsoft-excel', 'microsoft_excel'],
    ['Cal.com', 'calcom'],
    ['Zoho Desk', 'zoho_desk'],
    ['salesforce-sandbox', 'salesforce'],
  ])('resolves metadata-backed alias %s to %s', (alias, service) => {
    const tool = { ...tools[0]!, name: `${service}_read`, service }
    expect(
      projectIntegrationCatalog([tool], { ...input, service: alias }).operations.map(
        (operation) => operation.toolId
      )
    ).toEqual([tool.name])
  })

  it('keeps specific service filters narrow and shared credential families scoped to supplied tools', () => {
    const authorized = ['google_drive', 'google_slides', 'gmail', 'slack'].map((service) => ({
      ...tools[0]!,
      name: `${service}_read`,
      service,
    }))
    for (const service of ['google_drive', 'google-drive', 'Google Drive']) {
      expect(
        projectIntegrationCatalog(authorized, { ...input, service }).operations.map(
          (operation) => operation.service
        )
      ).toEqual(['google_drive'])
    }
    expect(
      projectIntegrationCatalog(authorized, {
        ...input,
        service: 'google-service-account',
      }).operations.map((operation) => operation.service)
    ).toEqual(['gmail', 'google_drive', 'google_slides'])
    expect(
      projectIntegrationCatalog(
        authorized.filter((tool) => tool.service === 'google_slides'),
        {
          ...input,
          service: 'google-drive',
        }
      ).operations
    ).toEqual([])
  })

  it('derives new provider bindings from callable tools before public metadata is published', () => {
    const preview = {
      ...tools[0]!,
      name: 'preview_service_read',
      service: 'preview_service',
      oauth: { required: true, provider: 'preview-service-provider' },
    }
    expect(
      projectIntegrationCatalog([preview, ...tools], {
        ...input,
        service: 'preview-service-provider',
      }).operations.map((operation) => operation.toolId)
    ).toEqual([preview.name])
  })

  it('distinguishes an unrecognized filter from valid empty results without revealing other tools', () => {
    expect(() => projectIntegrationCatalog(tools, { ...input, service: 'gogle-calndar' })).toThrow(
      'Unknown integration service'
    )
    expect(
      projectIntegrationCatalog(tools, { ...input, service: 'Google Calendar' }).operations
    ).toEqual([])
    expect(
      projectIntegrationCatalog(tools, { ...input, service: 'gmail', query: 'nonexistent' })
        .operations
    ).toEqual([])
    expect(
      projectIntegrationCatalog(tools, { ...input, service: 'mcp:unselected-server' }).operations
    ).toEqual([])
  })

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
  it.each(['agent', 'plan'] as const)(
    'preserves integration discovery for %s conversations',
    async (mode) => {
      queueChat(mode)
      const result = await readIntegrationCatalog.execute({
        principal: principal(),
        input: IntegrationCatalogRequest.parse({
          ...input,
          mode,
          service: 'google-email',
          query: 'email',
        }),
      })
      expect(result.operations.map((operation) => operation.toolId)).toEqual(['gmail_send'])
      expect(mocks.build).toHaveBeenCalledWith(
        'actor',
        { schemaSurface: 'copilot', organizationId: 'org-1' },
        undefined
      )
    }
  )

  it('does not discover MCP operations in Search even with selected servers', async () => {
    queueChat()
    mocks.mcp.mockResolvedValue([{ ...tools[0], name: 'mcp-abc-send', service: 'mcp:mcp-abc' }])
    const result = await readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, service: 'mcp:mcp-abc', mcpServerIds: ['mcp-abc'] },
    })
    expect(result.operations).toEqual([])
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

it.each([undefined, 'mcp-abc-write'])(
  'exposes selected MCP operations without enabling sibling operations (exact lookup: %s)',
  async (toolId) => {
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
        ...(toolId ? { toolId } : {}),
      },
    })
    expect(mocks.mcp).toHaveBeenCalledWith('actor', 'workspace-1', ['mcp-abc'], undefined)
    expect(result.operations.map((operation) => operation.toolId)).toEqual(
      toolId ? [] : ['mcp-abc-read']
    )
  }
)
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

it('removes previously discoverable Search operations when the runtime flag turns off', async () => {
  for (const enabled of [true, false, true]) {
    mocks.flag.mockResolvedValue(enabled)
    queueChat()
    const result = await readIntegrationCatalog.execute({ principal: principal(), input })
    expect(result.operations.map((operation) => operation.toolId)).toEqual(
      enabled ? ['gmail_send', 'slack_send'] : []
    )
  }
})
