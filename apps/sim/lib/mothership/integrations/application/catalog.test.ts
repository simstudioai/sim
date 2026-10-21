import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { authBanMock, authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
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
  credentials: credentialsEnvironmentMockFns.mockGetAccessibleOAuthCredentials,
  managed: credentialsEnvironmentMockFns.mockGetEnrolledManagedOAuthCredentials,
}
vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)
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
  mocks.credentials.mockResolvedValue([])
  mocks.managed.mockResolvedValue([])
})

/**
 * Real registry descriptions and parameters: email-capable and customer-facing operations, plus
 * unrelated ones so term rarity resembles the full catalog, where most operations are neither.
 */
const catalogRows: [string, string, string, string, string?][] = [
  [
    'gmail_send',
    'gmail',
    'Send emails using Gmail',
    'to,subject,body,cc,bcc,attachments',
    'google-email',
  ],
  [
    'gmail_send_v2',
    'gmail',
    'Send emails using Gmail.',
    'to,subject,body,cc,bcc,attachments',
    'google-email',
  ],
  ['gmail_search', 'gmail', 'Search emails in Gmail', 'query,maxResults', 'google-email'],
  [
    'outlook_send',
    'outlook',
    'Send emails using Outlook',
    'to,subject,body,cc,bcc,attachments',
    'outlook',
  ],
  [
    'agentmail_send_message',
    'agentmail',
    'Send an email message from an AgentMail inbox',
    'apiKey,inboxId,to,subject,text,html,cc,bcc',
  ],
  [
    'agentmail_send_draft',
    'agentmail',
    'Send an existing email draft in AgentMail',
    'apiKey,inboxId,draftId',
  ],
  [
    'lemlist_send_email',
    'lemlist',
    'Sends an email to a contact through the Lemlist inbox.',
    'apiKey,sendUserId,contactId,subject,message,cc',
  ],
  [
    'mailgun_send_message',
    'mailgun',
    'Send an email using Mailgun API',
    'apiKey,domain,from,to,subject,text,html',
  ],
  [
    'sendgrid_send_mail',
    'sendgrid',
    'Send an email using SendGrid API',
    'apiKey,from,to,subject,content,templateId',
  ],
  [
    'ses_send_email',
    'ses',
    'Send an email via AWS SES using simple or HTML content',
    'region,fromAddress,toAddresses,subject,bodyText',
  ],
  [
    'resend_send',
    'resend',
    'Send an email using your own Resend API key and from address',
    'fromAddress,to,subject,body',
  ],
  [
    'smtp_send_mail',
    'smtp',
    'Send emails via SMTP server',
    'smtpHost,smtpPort,from,to,subject,body',
  ],
  ['stripe_send_invoice', 'stripe', 'Send an invoice to the customer', 'apiKey,id'],
  ['stripe_list_customers', 'stripe', 'List all customers', 'apiKey,limit,email'],
  [
    'helpscout_create_conversation',
    'helpscout',
    'Create a Help Scout conversation in an inbox with a first customer message, reply, or note. A new customer is created when the email is not already known.',
    'subject,mailboxId,customerId,customerEmail,text',
  ],
  [
    'hubspot_create_contact',
    'hubspot',
    'Create a new contact in HubSpot. Requires at least one of: email, firstname, or lastname',
    'properties,associations',
  ],
  [
    'zendesk_create_ticket',
    'zendesk',
    'Create a new ticket in Zendesk with support for custom fields',
    'email,apiToken,subdomain,subject,description',
  ],
  [
    'slack_message',
    'slack',
    'Send messages to Slack channels or direct messages.',
    'channel,text,threadTs',
    'slack',
  ],
  [
    'google_calendar_list_v2',
    'google_calendar',
    'List events from Google Calendar',
    'calendarId,timeMin,timeMax',
    'google-calendar',
  ],
  [
    'github_list_prs_v2',
    'github',
    'List pull requests in a GitHub repository',
    'owner,repo,state',
    'github',
  ],
  [
    'github_create_issue_v2',
    'github',
    'Create a new issue in a GitHub repository',
    'owner,repo,title,body',
    'github',
  ],
  ['jira_write', 'jira', 'Write a Jira issue', 'domain,projectId,summary,description', 'jira'],
  [
    'jira_search_issues',
    'jira',
    'Search for Jira issues using JQL',
    'domain,jql,maxResults',
    'jira',
  ],
  [
    'linear_create_issue',
    'linear',
    'Create a new issue in Linear',
    'teamId,title,description',
    'linear',
  ],
  [
    'notion_create_page',
    'notion',
    'Create a new page in Notion',
    'parentId,title,content',
    'notion',
  ],
  [
    'notion_query_database',
    'notion',
    'Query and filter Notion database entries with advanced filtering',
    'databaseId,filter,sorts',
    'notion',
  ],
  [
    'google_sheets_read_v2',
    'google_sheets',
    'Read data from a specific sheet in a Google Sheets spreadsheet',
    'spreadsheetId,sheetName,cellRange',
    'google-sheets',
  ],
  [
    'google_sheets_update_v2',
    'google_sheets',
    'Update data in a specific sheet in a Google Sheets spreadsheet',
    'spreadsheetId,sheetName,cellRange,values',
    'google-sheets',
  ],
  [
    'google_drive_upload',
    'google_drive',
    'Upload a file to Google Drive',
    'fileName,content,folderId',
    'google-drive',
  ],
  [
    'airtable_list_records',
    'airtable',
    'Read records from an Airtable table',
    'baseId,tableId,maxRecords',
    'airtable',
  ],
  ['asana_create_task', 'asana', 'Create a new task in Asana', 'workspace,name,notes', 'asana'],
  [
    'trello_create_card',
    'trello',
    'Create a new card on a Trello board',
    'listId,name,desc',
    'trello',
  ],
  ['dropbox_upload', 'dropbox', 'Upload a file to Dropbox', 'path,fileContent,mode', 'dropbox'],
  [
    'confluence_retrieve',
    'confluence',
    'Retrieve content from Confluence pages using the Confluence API.',
    'domain,pageId',
    'confluence',
  ],
  [
    'discord_send_message',
    'discord',
    'Send a message to a Discord channel',
    'botToken,channelId,content',
  ],
  [
    'postgresql_query',
    'postgresql',
    'Execute a SELECT query on PostgreSQL database',
    'host,port,database,query',
  ],
  [
    'openai_embeddings',
    'openai',
    'Generate embeddings from text using OpenAI',
    'input,model,apiKey',
  ],
  [
    'firecrawl_scrape',
    'firecrawl',
    'Extract structured content from web pages',
    'url,scrapeOptions,apiKey',
  ],
  [
    'youtube_search',
    'youtube',
    'Search for videos on YouTube using the YouTube Data API.',
    'query,maxResults,apiKey',
  ],
]
const emailCapable = catalogRows.map(([name, service, description, parameters, provider]) => ({
  name,
  service,
  description,
  input_schema: {
    type: 'object',
    properties: Object.fromEntries(parameters.split(',').map((key) => [key, { type: 'string' }])),
  },
  ...(provider ? { oauth: { required: true, provider } } : {}),
}))
function rankOf(toolId: string, query: string, connectedProviderIds: string[] = []) {
  return (
    projectIntegrationCatalog(emailCapable, { ...input, query, limit: 0 }, { connectedProviderIds })
      .operations.map((operation) => operation.toolId)
      .indexOf(toolId) + 1
  )
}

describe('integration catalog ranking', () => {
  it('ranks a connected Gmail send operation in the top three for a natural-language email intent', () => {
    const rank = rankOf('gmail_send', 'send an email to a customer', ['google-email'])
    expect(rank).toBeGreaterThan(0)
    expect(rank).toBeLessThanOrEqual(3)
  })

  it('ranks the connected service ahead of an equally relevant unconnected one', () => {
    expect(rankOf('outlook_send', 'send email', ['outlook'])).toBeLessThan(
      rankOf('gmail_send', 'send email', ['outlook'])
    )
    expect(rankOf('gmail_send', 'send email', ['google-email'])).toBeLessThan(
      rankOf('outlook_send', 'send email', ['google-email'])
    )
  })

  it('never matches on a stop word that folds to another term', () => {
    const setnx = {
      name: 'redis_setnx',
      description: 'Set a key only if it does not exist',
      input_schema: { type: 'object', properties: {} },
    }
    const doe = {
      name: 'crm_find_doe',
      description: 'Find a Jane Doe record',
      input_schema: { type: 'object', properties: {} },
    }
    expect(
      projectIntegrationCatalog([setnx, doe], {
        ...input,
        query: 'what does setnx do',
        limit: 0,
      }).operations.map((operation) => operation.toolId)
    ).toEqual(['redis_setnx'])
  })

  it('folds -es plurals onto their singular', () => {
    const branch = {
      name: 'github_create_branch',
      description: 'Create a branch',
      input_schema: { type: 'object', properties: {} },
    }
    const warehouse = {
      name: 'snowflake_get_warehouse',
      description: 'Get a warehouse',
      input_schema: { type: 'object', properties: {} },
    }
    for (const query of ['branches', 'branch', 'warehouses', 'warehouse'])
      expect(
        projectIntegrationCatalog([branch, warehouse], {
          ...input,
          query,
          limit: 0,
        }).operations.map((operation) => operation.toolId)
      ).toEqual([query.startsWith('branch') ? 'github_create_branch' : 'snowflake_get_warehouse'])
  })

  /** An agent reading total 0 would conclude the workspace has no integrations at all. */
  it('lists every operation, compactly, for a query with no content terms', () => {
    const listing = projectIntegrationCatalog(emailCapable, { ...input, limit: 0 })
    for (const query of [
      'all',
      'any',
      'what can I use',
      'a the to of',
      'x y z',
      'gets uses',
      '发送邮件',
    ])
      expect(projectIntegrationCatalog(emailCapable, { ...input, query, limit: 0 })).toEqual(
        listing
      )
    expect(listing.total).toBe(emailCapable.length)
  })

  it('only counts operations that share a content term with the intent', () => {
    const result = projectIntegrationCatalog(emailCapable, {
      ...input,
      query: 'send an email to a customer',
      limit: 0,
    })
    expect(result.operations.map((operation) => operation.toolId)).not.toContain(
      'google_calendar_list_v2'
    )
  })

  it('ranks an exact operation ID first even over a connected, more repetitive match', () => {
    expect(rankOf('outlook_send', 'outlook_send', ['google-email'])).toBe(1)
    expect(rankOf('gmail_send', 'gmail_send', ['outlook'])).toBe(1)
  })

  it('breaks only score ties by preferred service, after the connected boost', () => {
    const twins = ['alpha', 'beta'].map((service) => ({
      name: `${service}_send`,
      service,
      description: 'Send an email',
      input_schema: { type: 'object', properties: {} },
      oauth: { required: true, provider: `${service}-provider` },
    }))
    const order = (preferred: string[], connectedProviderIds: string[] = []) =>
      projectIntegrationCatalog(
        twins,
        { ...input, query: 'send email', limit: 0 },
        { preferredServices: new Set(preferred), connectedProviderIds }
      ).operations.map((operation) => operation.toolId)
    expect(order([])).toEqual(['alpha_send', 'beta_send'])
    expect(order(['beta'])).toEqual(['beta_send', 'alpha_send'])
    expect(order(['beta'], ['alpha-provider'])).toEqual(['alpha_send', 'beta_send'])
  })
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
  it('returns schemas only for a matching query, service filter or exact ID and never guesses unknown tools', () => {
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
      projectIntegrationCatalog(tools, { ...input, service: 'gmail' }).operations[0]?.inputSchema
    ).toEqual({ type: 'object' })
  })
})
describe('catalog authorization', () => {
  it('boosts the services the requester has connected in the authorized target workspace', async () => {
    queueChat('agent')
    mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.build.mockResolvedValue(structuredClone(emailCapable))
    mocks.credentials.mockResolvedValue([{ id: 'credential-1', providerId: 'outlook' }])
    const result = await readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode: 'agent', workspaceId: 'workspace-1', query: 'send email' },
    })
    expect(mocks.credentials).toHaveBeenCalledWith('workspace-1', 'actor')
    expect(result.operations[0]?.toolId).toBe('outlook_send')
  })

  it('boosts a service the requester connected through a managed account', async () => {
    queueChat('agent')
    mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.build.mockResolvedValue(structuredClone(emailCapable))
    mocks.managed.mockResolvedValue([{ id: 'credential-2', providerId: 'outlook' }])
    const result = await readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode: 'agent', workspaceId: 'workspace-1', query: 'send email' },
    })
    expect(mocks.managed).toHaveBeenCalledWith('workspace-1', 'actor')
    expect(result.operations[0]?.toolId).toBe('outlook_send')
  })

  it('still lists operations, unboosted, when the connected-service lookup fails', async () => {
    queueChat('agent')
    mocks.target.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.build.mockResolvedValue(structuredClone(emailCapable))
    mocks.credentials.mockRejectedValue(new Error('database unavailable'))
    const result = await readIntegrationCatalog.execute({
      principal: principal(),
      input: { ...input, mode: 'agent', workspaceId: 'workspace-1', query: 'send email' },
    })
    expect(result.operations.length).toBeGreaterThan(0)
  })

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
        input: { workspaceId: 'workspace-1', serverId: 'mcp-docs', bestEffort: true },
      })
    }
  )

  it('keeps built-ins and tagged servers when the workspace server list fails', async () => {
    mocks.listServers.mockRejectedValue(new Error('connection terminated'))
    const result = await catalog({ mcpServerIds: ['mcp-docs'] })
    expect(toolIds(result)).toEqual(['mcp-docs-lookup', 'gmail_send', 'slack_send'])
    expect(discoveredServerIds()).toEqual(['mcp-docs'])
    await expect(catalog({ service: 'mcp:mcp-crm' })).rejects.toThrow('connection terminated')
  })

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
