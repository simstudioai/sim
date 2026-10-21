import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { authBanMock, authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import {
  MockMcpToolsNotAllowedError,
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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

const hoisted = vi.hoisted(() => ({ flag: vi.fn(async () => true) }))
const mocks = {
  ...hoisted,
  discover: mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase,
  mcpPermission: permissionCheckMockFns.mockAssertPermissionsAllowed,
  build: mothershipChatPayloadMockFns.mockBuildIntegrationToolSchemas,
  banned: authBanMockFns.mockGetActivelyBannedUserIds,
  target: mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace,
  listServers: mcpUseCasesMockFns.mockListMcpServersUseCase,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/lib/internal/mcp/discover-tools', () => ({ discoverMcpServerToolsAsExecutor: vi.fn() }))
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@/lib/auth/ban', () => authBanMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/mothership/feature-flags', () => ({ isSearchIntegrationToolsEnabled: hoisted.flag }))

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
function usableServer(id: string, overrides: Record<string, unknown> = {}) {
  return { id, enabled: true, credentialGroupId: null, ...overrides }
}
function discoveredServerIds() {
  return mocks.discover.mock.calls.map(([args]) => args.input.serverId)
}
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
  mocks.discover.mockReset()
  mocks.discover.mockResolvedValue({ tools: [] })
  mocks.mcpPermission.mockResolvedValue(undefined)
  mocks.listServers.mockResolvedValue({ servers: [usableServer('mcp-abc')] })
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
    mocks.discover.mockResolvedValue({
      tools: [{ serverId: 'mcp-abc', name: 'send', description: 'Send', inputSchema: {} }],
    })
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
    mocks.discover.mockResolvedValue({
      tools: [
        { serverId: 'mcp-abc', name: 'read', description: 'Read', inputSchema: {} },
        { serverId: 'mcp-abc', name: 'write', description: 'Write', inputSchema: {} },
      ],
    })
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
    expect(discoveredServerIds()).toEqual(['mcp-abc'])
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
  expect(mocks.discover).not.toHaveBeenCalled()
})
it('requires an explicit workspace target for organization MCP discovery', async () => {
  queueChat('agent')
  await expect(
    readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode: 'agent', mcpServerIds: ['mcp-abc'], toolId: 'mcp-abc-read' },
    })
  ).rejects.toThrow('explicit workspace ID')
  expect(mocks.discover).not.toHaveBeenCalled()
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
  expect(discoveredServerIds()).toEqual(['mcp-abc'])
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

describe('tagged MCP servers that cannot be discovered', () => {
  const failures: Record<string, () => Promise<never> | Promise<{ tools: never[] }>> = {
    'mcp-deleted': async () => {
      throw new OrchestrationError('not_found', 'MCP server not found')
    },
    'mcp-down': async () => {
      throw new Error('connect ECONNREFUSED')
    },
    'mcp-empty': async () => ({ tools: [] }),
  }
  const serverIds = ['mcp-abc', ...Object.keys(failures)]
  function catalog(request: Partial<IntegrationCatalogRequest>) {
    queueChat('agent')
    return readIntegrationCatalog.execute({
      principal: principal(),
      input: {
        ...input,
        mode: 'agent',
        workspaceId: 'workspace-1',
        mcpServerIds: serverIds,
        ...request,
      },
    })
  }
  beforeEach(() => {
    mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.listServers.mockResolvedValue({ servers: serverIds.map((id) => usableServer(id)) })
    mocks.discover.mockImplementation(async ({ input: { serverId } }) => {
      const failure = failures[serverId]
      if (failure) return failure()
      return { tools: [{ serverId, name: 'send', description: 'Send a note', inputSchema: {} }] }
    })
  })

  it.each([undefined, 'send'])(
    'still lists native and healthy MCP operations (query: %s)',
    async (query) => {
      const result = await catalog(query ? { query } : {})
      expect(result.operations.map((operation) => operation.toolId)).toEqual(
        expect.arrayContaining(['gmail_send', 'slack_send', 'mcp-abc-send'])
      )
      expect(result.operations).toHaveLength(3)
      expect(discoveredServerIds().sort()).toEqual([...serverIds].sort())
    }
  )

  it.each([
    ['mcp-deleted', 'MCP server not found'],
    ['mcp-down', 'connect ECONNREFUSED'],
    ['mcp-empty', 'No permitted MCP operations are available for mcp-empty'],
  ])('fails a request that targets %s with its own error', async (serverId, message) => {
    await expect(catalog({ service: `mcp:${serverId}` })).rejects.toThrow(message)
    await expect(catalog({ toolId: `${serverId}-send` })).rejects.toThrow(message)
  })
})

describe('untagged workspace MCP servers', () => {
  function catalog(
    request: Partial<IntegrationCatalogRequest>,
    mode: IntegrationCatalogRequest['mode'] = 'agent'
  ) {
    queueChat(mode)
    return readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode, workspaceId: 'workspace-1', ...request },
    })
  }
  function toolIds(result: { operations: Array<{ toolId: string }> }) {
    return result.operations.map((operation) => operation.toolId)
  }
  beforeEach(() => {
    mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.listServers.mockResolvedValue({
      servers: ['mcp-docs', 'mcp-crm'].map((id) => usableServer(id)),
    })
    mocks.discover.mockImplementation(async ({ input: { serverId } }) => ({
      tools: [{ serverId, name: 'lookup', description: 'Look up a record', inputSchema: {} }],
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['agent', 'plan'] as const)(
    'discovers every usable server without a tag in %s mode, from the discovery cache',
    async (mode) => {
      const result = await catalog({ query: 'lookup' }, mode)
      expect(toolIds(result)).toEqual(['mcp-crm-lookup', 'mcp-docs-lookup'])
      expect(mocks.discover).toHaveBeenCalledWith({
        principal: expect.objectContaining({ workspaceId: 'workspace-1', subjectUserId: 'actor' }),
        input: { workspaceId: 'workspace-1', serverId: 'mcp-docs' },
      })
    }
  )

  it('keeps Search free of MCP even with usable workspace servers', async () => {
    const result = await catalog({}, 'assistant')
    expect(toolIds(result)).toEqual(['gmail_send', 'slack_send'])
    expect(mocks.listServers).not.toHaveBeenCalled()
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('never discovers disabled, deleted, or Credential Group servers', async () => {
    mocks.listServers.mockResolvedValue({
      servers: [
        usableServer('mcp-docs'),
        usableServer('mcp-off', { enabled: false }),
        usableServer('mcp-group', { credentialGroupId: 'group-1' }),
      ],
    })
    const result = await catalog({ mcpServerIds: ['mcp-deleted'], query: 'lookup' })
    expect(toolIds(result)).toEqual(['mcp-docs-lookup'])
    expect(discoveredServerIds()).toEqual(['mcp-docs'])
  })

  it('keeps a workflow selection scoped to the operations it selected', async () => {
    const result = await catalog({ mcpToolIds: ['mcp-docs-lookup'] })
    expect(toolIds(result)).toEqual(['gmail_send', 'mcp-docs-lookup', 'slack_send'])
    expect(discoveredServerIds()).toEqual(['mcp-docs'])
    expect(mocks.listServers).not.toHaveBeenCalled()
  })

  it('ranks a tagged server ahead of an equally relevant untagged one', async () => {
    const result = await catalog({ mcpServerIds: ['mcp-docs'], query: 'lookup' })
    expect(toolIds(result)).toEqual(['mcp-docs-lookup', 'mcp-crm-lookup'])
  })

  it('skips an untagged server that does not answer in time without failing the query', async () => {
    vi.useFakeTimers()
    mocks.discover.mockImplementation(async ({ input: { serverId } }) =>
      serverId === 'mcp-crm'
        ? new Promise(() => {})
        : {
            tools: [{ serverId, name: 'lookup', description: 'Look up a record', inputSchema: {} }],
          }
    )
    const pending = catalog({ query: 'lookup' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(toolIds(await pending)).toEqual(['mcp-docs-lookup'])
  })

  it('lists native operations when a permission group disables MCP', async () => {
    mocks.mcpPermission.mockRejectedValue(new MockMcpToolsNotAllowedError())
    const result = await catalog({ mcpServerIds: ['mcp-docs'] })
    expect(toolIds(result)).toEqual(['gmail_send', 'slack_send'])
    expect(mocks.discover).not.toHaveBeenCalled()
    await expect(catalog({ service: 'mcp:mcp-docs' })).rejects.toThrow('MCP tools are not allowed')
  })

  it('resolves an untagged server operation by exact ID for execution', async () => {
    const result = await catalog({ toolId: 'mcp-crm-lookup' })
    expect(result.operations).toEqual([
      {
        toolId: 'mcp-crm-lookup',
        service: 'mcp:mcp-crm',
        description: 'Look up a record',
        inputSchema: {},
      },
    ])
    expect(mocks.discover).toHaveBeenCalledTimes(1)
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { workspaceId: 'workspace-1', serverId: 'mcp-crm', requireComplete: true },
      })
    )
    mocks.discover.mockRejectedValue(new Error('connect ECONNREFUSED'))
    await expect(catalog({ toolId: 'mcp-crm-lookup' })).rejects.toThrow('connect ECONNREFUSED')
  })
})
