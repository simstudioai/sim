import { envFlagsMockFns, resetEnvFlagsMock, workflowsUtilsMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { billingPlanHelpersMock } from '@sim/testing/mocks/billing-plan-helpers.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  integrationsAvailabilityMock,
  integrationsAvailabilityMockFns,
} from '@sim/testing/mocks/integrations-availability.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getExposedIntegrationTools } from '@/lib/integrations/tool-catalog'
import { ChatPayloadSchema, TOOL_DEADLINE_CAPABILITY } from '@/lib/mothership/generated/protocol'
import { searchUsersV2Tool } from '@/tools/github/search_users'
import { gmailListLabelsV2Tool } from '@/tools/gmail/list_labels'
import { getToolMetadata } from '@/tools/metadata'

const {
  mockCreateUserToolSchema,
  mockDashboardAvailability,
  mockSecretNames,
  mockComputerUseAvailable,
  mockSearchIntegrationToolsEnabled,
} = vi.hoisted(() => ({
  mockDashboardAvailability: vi.fn(async () => false),
  mockComputerUseAvailable: vi.fn(async () => false),
  mockCreateUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
  mockSecretNames: vi.fn(async () => ({ names: [] as string[] })),
  mockSearchIntegrationToolsEnabled: vi.fn(async () => true),
}))

vi.mock('@/lib/computer-use/application/availability', () => ({
  isComputerUseAvailableFor: mockComputerUseAvailable,
}))

vi.mock('@/lib/mothership/feature-flags', () => ({
  isSearchIntegrationToolsEnabled: mockSearchIntegrationToolsEnabled,
}))

beforeEach(() => mockSearchIntegrationToolsEnabled.mockResolvedValue(true))

// The inventory reads nine application worlds; these suites exercise the request shape, not the reads.
vi.mock('@/lib/mothership/application/execute-organization-secret-use-case', () => ({
  executeOrganizationSecretUseCase: mockSecretNames,
}))
vi.mock('@/lib/mothership/chat/workspace-inventory', () => ({
  buildWorkspaceInventory: vi.fn(async () => ({
    workflows: [],
    tables: [],
    knowledgeBases: [],
    files: [],
    skills: [],
    customTools: [],
    mcpServers: [],
    credentials: [],
    secrets: [],
    truncated: [],
  })),
}))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/dashboards/application/availability', () => ({
  readDashboardAvailability: { execute: mockDashboardAvailability },
}))
vi.mock('@/lib/workflow-tests/application/availability', () => ({
  readWorkflowTestAvailability: { execute: vi.fn(async () => false) },
}))
vi.mock('@/lib/changelog/application/availability', () => ({
  readChangelogAvailability: { execute: vi.fn(async () => false) },
}))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
const mockGetHighestPrioritySubscription =
  billingSubscriptionMockFns.mockGetHighestPrioritySubscription
const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
const mockTrackChatUpload = workspaceFileManagerMockFns.mockTrackChatUpload
const {
  mockIsIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
  mockIsOAuthServiceDeploymentAvailable,
} = integrationsAvailabilityMockFns
const mockSearchApprovals =
  knowledgeSearchIntegrationPolicyMockFns.mockListOrganizationSearchApprovals
mockSearchApprovals.mockResolvedValue(new Map<string, boolean>())
vi.mocked(getToolMetadata).mockImplementation((id) =>
  id === gmailListLabelsV2Tool.id
    ? gmailListLabelsV2Tool
    : id === 'github_search_users_v2'
      ? searchUsersV2Tool
      : id === 'gmail_send'
        ? {
            id,
            params: { accessToken: { type: 'string', visibility: 'hidden', required: true } },
            oauth: { required: true, provider: 'google-email' },
          }
        : undefined
)
permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockImplementation(
  (...args) => mockGetUserPermissionConfig(...args)
)

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

/** Denied-operation projection walks the block map only for blocks the mocked tool list never names. */
vi.mock('@/blocks/registry-maps', () => ({ BLOCK_REGISTRY: {}, BLOCK_META_REGISTRY: {} }))

vi.mock('@/tools/utils', () => ({
  getLatestVersionTools: vi.fn((input) => input),
  stripVersionSuffix: vi.fn((toolId: string) => toolId),
}))

vi.mock('@/lib/mothership/block-visibility', () => ({
  getBlockVisibilityForCopilot: vi.fn(async () => ({
    revealed: new Set<string>(),
    disabled: new Set<string>(),
    previewTagged: new Set<string>(),
  })),
}))

vi.mock('@/lib/integrations/tool-catalog', () => ({
  filterExposedIntegrationTools: vi.fn(
    (
      tools: Array<{ toolId: string; blockType: string; service: string }>,
      _vis: unknown,
      isOwnerAllowed: (owner: { blockType: string; service: string }) => boolean,
      isToolAllowed: (toolId: string) => boolean = () => true
    ) => tools.filter((tool) => isToolAllowed(tool.toolId) && isOwnerAllowed(tool))
  ),
  getExposedIntegrationTools: vi.fn(() => [
    {
      toolId: 'gmail_send',
      config: {
        id: 'gmail_send',
        name: 'Gmail Send',
        description: 'Send emails using Gmail',
        outputs: { messageId: { type: 'string', description: 'Sent message ID' } },
        oauth: { required: true, provider: 'google-email' },
      },
      service: 'gmail',
      operation: 'send',
      blockType: 'gmail',
    },
    {
      toolId: 'brandfetch_search',
      config: {
        id: 'brandfetch_search',
        name: 'Brandfetch Search',
        description: 'Search for brands by company name',
      },
      service: 'brandfetch',
      operation: 'search',
      blockType: 'brandfetch',
    },
    {
      toolId: 'run_workflow',
      config: {
        id: 'run_workflow',
        name: 'Run Workflow',
        description: 'Run a workflow from the client',
      },
      service: 'run',
      operation: 'workflow',
      blockType: 'run',
    },
  ]),
}))

vi.mock('@/tools/params', () => ({
  createUserToolSchema: mockCreateUserToolSchema,
}))

vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)

import {
  buildCopilotRequestPayload,
  buildIntegrationToolSchemas,
  clearIntegrationToolSchemaCacheForTests,
} from '@/lib/mothership/chat/payload'

describe('buildIntegrationToolSchemas', () => {
  beforeEach(() => {
    resetEnvFlagsMock()
    clearIntegrationToolSchemaCacheForTests()
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
    mockIsOAuthServiceDeploymentAvailable.mockReturnValue(true)
    mockGetUserPermissionConfig.mockResolvedValue(null)
  })

  it('emits executeLocally for dynamic client tools only', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-client')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const runTool = toolSchemas.find((tool) => tool.name === 'run_workflow')

    expect(gmailTool?.executeLocally).toBe(false)
    expect(runTool?.executeLocally).toBe(true)
  })

  it('removes tools whose canonical exposed block is unavailable', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockIsIntegrationDeploymentAvailable.mockImplementation((blockType: string) => {
      return blockType !== 'gmail'
    })

    const toolSchemas = await buildIntegrationToolSchemas('user-deployment-filter')

    expect(toolSchemas.some((tool) => tool.name === 'gmail_send')).toBe(false)
    expect(toolSchemas.some((tool) => tool.name === 'brandfetch_search')).toBe(true)
  })

  it('intersects workspace and deployment integration allowlists', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['gmail', 'brandfetch'],
    })
    envFlagsMockFns.getAllowedIntegrationsFromEnv.mockReturnValue(['brandfetch'])

    const toolSchemas = await buildIntegrationToolSchemas(
      'user-intersection',
      { schemaSurface: 'copilot' },
      'workspace-1'
    )

    expect(toolSchemas.some((tool) => tool.name === 'gmail_send')).toBe(false)
    expect(toolSchemas.some((tool) => tool.name === 'brandfetch_search')).toBe(true)
  })

  it('keeps a limited integration callable without advertising OAuth', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockIsOAuthServiceDeploymentAvailable.mockImplementation(
      (providerId: string) => providerId !== 'google-email'
    )

    const toolSchemas = await buildIntegrationToolSchemas('user-limited-integration')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(gmailTool).toBeDefined()
    expect(gmailTool).not.toHaveProperty('oauth')
  })

  it('fails closed when workspace integration permissions cannot be loaded', async () => {
    mockGetUserPermissionConfig.mockRejectedValue(new Error('permission backend unavailable'))

    await expect(
      buildIntegrationToolSchemas(
        'user-permission-error',
        { schemaSurface: 'copilot' },
        'workspace-1'
      )
    ).rejects.toThrow('permission backend unavailable')
    expect(mockCreateUserToolSchema).not.toHaveBeenCalled()
  })

  it('builds each tool schema once per process, not once per viewer', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockGetUserPermissionConfig.mockResolvedValueOnce({ allowedIntegrations: ['gmail'] })

    await buildIntegrationToolSchemas('user-a', { schemaSurface: 'copilot' }, 'workspace-a')
    await buildIntegrationToolSchemas('user-b', { schemaSurface: 'copilot' }, 'workspace-b')
    await buildIntegrationToolSchemas('user-b', { schemaSurface: 'copilot' }, 'workspace-b')

    expect(mockCreateUserToolSchema).toHaveBeenCalledTimes(3)
  })

  it('keeps one caller from changing what any other viewer receives', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockCreateUserToolSchema.mockReturnValue({
      type: 'object',
      properties: { recipients: { type: 'array', items: { type: 'string' } } },
      required: ['recipients'],
    })
    const first = await buildIntegrationToolSchemas('user-mutating')
    first.push({ name: 'mcp-private-tool', description: '', input_schema: {} })
    expect(() => {
      ;(first[0].input_schema.properties as Record<string, unknown>).recipients = { type: 'number' }
    }).toThrow(TypeError)
    expect(() => (first[0].input_schema.required as string[]).push('forged')).toThrow(TypeError)
    expect(() => {
      first[0].description = 'forged'
    }).toThrow(TypeError)

    const second = await buildIntegrationToolSchemas('user-reading')
    expect(second.map((tool) => tool.name)).toEqual([
      'gmail_send',
      'brandfetch_search',
      'run_workflow',
    ])
    expect(second[0].description).not.toBe('forged')
    expect(second[0].input_schema.properties).toEqual({
      recipients: { type: 'array', items: { type: 'string' } },
    })
    expect(second[0].input_schema.required).toEqual(['recipients'])
  })

  it('appends the free-plan email tagline only for the viewer whose plan earns it', async () => {
    mockGetHighestPrioritySubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ plan: 'pro', status: 'active' })
    const tagline = 'sent with sim ai'
    const describeGmail = (tools: Array<{ name: string; description: string }>) =>
      tools.find((tool) => tool.name === 'gmail_send')?.description ?? ''

    const free = await buildIntegrationToolSchemas('free-user')
    const paid = await buildIntegrationToolSchemas('paid-user')
    const freeAgain = await buildIntegrationToolSchemas('free-user')

    expect(describeGmail(free)).toContain(tagline)
    expect(describeGmail(paid)).not.toContain(tagline)
    expect(describeGmail(freeAgain)).toContain(tagline)
  })

  it("gates the shared schemas by each viewer's own permission policy", async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockGetUserPermissionConfig
      .mockResolvedValueOnce({ allowedIntegrations: null, deniedTools: ['gmail_send'] })
      .mockResolvedValueOnce(null)

    const restricted = await buildIntegrationToolSchemas(
      'restricted-user',
      { schemaSurface: 'copilot' },
      'workspace-shared'
    )
    const unrestricted = await buildIntegrationToolSchemas(
      'open-user',
      { schemaSurface: 'copilot' },
      'workspace-shared'
    )

    expect(restricted.map((tool) => tool.name)).not.toContain('gmail_send')
    expect(unrestricted.map((tool) => tool.name)).toContain('gmail_send')
  })

  it('coalesces simultaneous catalog builds', async () => {
    const catalogs = await Promise.all(
      Array.from({ length: 20 }, () => buildIntegrationToolSchemas('concurrent-user'))
    )
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(1)
    expect(mockCreateUserToolSchema).toHaveBeenCalledTimes(3)
    expect(catalogs.every((catalog) => catalog.length === 3)).toBe(true)
  })

  it('propagates schema failures without caching a partial catalog', async () => {
    mockCreateUserToolSchema.mockImplementationOnce(() => {
      throw new Error('invalid tool schema')
    })
    await expect(buildIntegrationToolSchemas('schema-failure')).rejects.toThrow(
      'invalid tool schema'
    )
    const recovered = await buildIntegrationToolSchemas('schema-failure')
    expect(recovered).toHaveLength(3)
  })

  it('propagates subscription failures without caching a guessed catalog', async () => {
    mockGetHighestPrioritySubscription.mockRejectedValueOnce(new Error('billing unavailable'))
    await expect(buildIntegrationToolSchemas('subscription-failure')).rejects.toThrow(
      'billing unavailable'
    )
    expect(mockCreateUserToolSchema).not.toHaveBeenCalled()
    expect(await buildIntegrationToolSchemas('subscription-failure')).toHaveLength(3)
  })

  it('rebuilds instead of serving a cache entry from the previous policy', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: null, deniedTools: [] })

    const before = await buildIntegrationToolSchemas(
      'user-policy',
      { schemaSurface: 'copilot' },
      'workspace-policy'
    )
    expect(before.map((tool) => tool.name)).toContain('gmail_send')

    // An admin denies the tool. The viewer and surface are unchanged, so only
    // the policy component of the key can force a rebuild.
    mockGetUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: null,
      deniedTools: ['gmail_send'],
    })

    const after = await buildIntegrationToolSchemas(
      'user-policy',
      { schemaSurface: 'copilot' },
      'workspace-policy'
    )
    expect(after.map((tool) => tool.name)).not.toContain('gmail_send')
  })
})

describe('buildCopilotRequestPayload', () => {
  it.each([true, false])(
    'grants the dashboards entitlement from server availability: %s',
    async (enabled) => {
      const principal = { kind: 'session' as const, userId: 'actor' }
      mockDashboardAvailability.mockResolvedValueOnce(enabled)
      const payload = await buildCopilotRequestPayload({
        message: 'Show my dashboard',
        userId: 'actor',
        userMessageId: 'message-1',
        workspaceId: 'workspace-1',
        principal,
        mode: 'agent',
        model: '',
      })
      expect(payload.entitlements).toEqual(enabled ? ['dashboards'] : [])
      expect(payload.clientCapabilities).toEqual(['workflow-tool-pickup', TOOL_DEADLINE_CAPABILITY])
    }
  )

  it.each([
    ['dashboards', 'dashboards', true],
    ['dashboards', 'dashboards', false],
    ['tests', 'workflow-tests', true],
    ['tests', 'workflow-tests', false],
    ['changelog', 'changelog', true],
    ['changelog', 'changelog', false],
  ] as const)(
    'grants an organization Build chat the %s entitlement from the %s rollout: %s',
    async (entitlement, rolloutFlag, enabled) => {
      featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
        async (flag) => enabled && flag === rolloutFlag
      )
      const payload = await buildCopilotRequestPayload({
        message: 'Build it',
        userId: 'actor',
        userMessageId: 'message-1',
        organizationId: 'org-1',
        principal: { kind: 'session' as const, userId: 'actor' },
        mode: 'agent',
        model: '',
      })
      expect(payload.entitlements).toEqual(enabled ? [entitlement] : [])
      expect(featureFlagsMockFns.mockIsFeatureEnabled).toHaveBeenCalledWith(rolloutFlag, {
        orgId: 'org-1',
      })
    }
  )

  beforeEach(() => {
    mockTrackChatUpload.mockResolvedValue({ displayName: 'payroll.xlsx' })
    mockSecretNames.mockResolvedValue({ names: [] })
  })

  it.each(['workspace', 'organization'] as const)(
    'emits contract-valid %s Assistant context with no Build inventory or desktop declaration',
    async (owner) => {
      const payload = await buildCopilotRequestPayload({
        message: 'Find the document',
        userId: 'actor',
        userMessageId: '11111111-1111-4111-8111-111111111111',
        chatId: '22222222-2222-4222-8222-222222222222',
        mode: 'assistant',
        model: 'legacy-ui-model',
        ...(owner === 'organization'
          ? { organizationId: 'org-1' }
          : { workspaceId: '33333333-3333-4333-8333-333333333333' }),
        workflowId: 'ignored-workflow',
        workflowName: 'ignored-name',
        provider: 'legacy-provider',
        workspaceContext: '{"credentials":[]}',
        contexts: [{ type: 'workflow', content: 'ignored-context' }],
        browser: true,
        terminalCapable: true,
        mcpServerIds: ['mcp-1'],
      })
      expect(ChatPayloadSchema.safeParse(payload).success).toBe(true)
      expect(payload.context).toEqual([
        {
          type: owner === 'organization' ? 'search_integrations' : 'connected_accounts',
          content: '{"credentials":[]}',
        },
      ])
      for (const key of [
        'workflowId',
        'workflowName',
        'provider',
        'model',
        'inventory',
        'desktop',
        'mothershipTools',
      ])
        expect(payload).not.toHaveProperty(key)
      expect(payload.clientCapabilities).toEqual([TOOL_DEADLINE_CAPABILITY])
      if (owner === 'organization') expect(payload).not.toHaveProperty('integrationTools')
    }
  )

  it.each(['agent', 'plan', 'assistant'] as const)(
    'discovers Generic Secrets only for Build and Plan: %s',
    async (mode) => {
      mockSecretNames.mockResolvedValueOnce({ names: ['SERVICE_TOKEN'] })
      const payload = await buildCopilotRequestPayload({
        message: 'Use the service',
        userId: 'actor',
        userMessageId: 'message',
        chatId: 'chat',
        organizationId: 'org',
        mode,
        model: '',
      })
      const context = payload.context?.find((entry) => entry.type === 'generic_secrets')
      if (mode !== 'assistant') {
        expect(mockSecretNames).toHaveBeenCalledOnce()
        expect(mockSecretNames).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'actor',
            organizationId: 'org',
            chatId: 'chat',
            requestMode: mode,
            copilotToolExecution: true,
          }),
          expect.anything(),
          {}
        )
        expect(JSON.parse(context!.content)).toEqual({
          names: ['SERVICE_TOKEN'],
          usage: expect.stringContaining('environment variables'),
        })
      } else {
        expect(mockSecretNames).not.toHaveBeenCalled()
        expect(context).toBeUndefined()
      }
    }
  )

  describe('file attachment tracking', () => {
    const attachmentParams = {
      message: 'hi',
      userId: 'mallory',
      userMessageId: 'msg-1',
      mode: 'agent',
      model: 'claude-opus-4-8',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      fileAttachments: [
        {
          id: 'a1',
          key: 'workspace/ws-1/1731000000000-ab12cd34-payroll.xlsx',
          filename: 'payroll.xlsx',
          size: 1,
        },
      ],
    }

    /**
     * Tracking writes `workspace_files` rows. A read-only member reaching the
     * chat endpoint must not gain that write through an attachment.
     */
    it.each(['read', undefined])('does not track attachments for permission %s', async (perm) => {
      await buildCopilotRequestPayload({ ...attachmentParams, userPermission: perm })

      expect(mockTrackChatUpload).not.toHaveBeenCalled()
    })

    it.each(['write', 'admin'])('tracks attachments for permission %s', async (perm) => {
      await buildCopilotRequestPayload({ ...attachmentParams, userPermission: perm })

      expect(mockTrackChatUpload).toHaveBeenCalledWith(
        'ws-1',
        'mallory',
        'chat-1',
        'workspace/ws-1/1731000000000-ab12cd34-payroll.xlsx',
        expect.anything(),
        expect.anything(),
        1,
        'msg-1'
      )
    })

    it('includes successfully prepared attachments in the model context', async () => {
      const payload = await buildCopilotRequestPayload({
        ...attachmentParams,
        userPermission: 'write',
      })

      expect(payload.context).toEqual([
        {
          type: 'uploaded_file',
          content: [
            'File "payroll.xlsx" (application/octet-stream, 1 bytes) uploaded to this chat as "uploads/payroll.xlsx" (a chat upload: readable here, not listed under workspace files/).',
            'Read it with sim_cli: {"args":["files","read","uploads/payroll.xlsx"]}',
            'Pass the same path "uploads/payroll.xlsx" as inputs.files[].path to mount it in run_code.',
          ].join('\n'),
        },
      ])
    })

    it('isolates a failed attachment and still prepares valid siblings', async () => {
      const cause = new Error('provenance sidecar unavailable')
      mockTrackChatUpload
        .mockRejectedValueOnce(cause)
        .mockResolvedValueOnce({ displayName: 'photo.png' })

      const payload = await buildCopilotRequestPayload({
        ...attachmentParams,
        userPermission: 'write',
        fileAttachments: [
          ...attachmentParams.fileAttachments,
          {
            id: 'a2',
            key: 'workspace/ws-1/1731000000001-ab12cd35-photo.png',
            filename: 'photo.png',
            media_type: 'image/png',
            size: 10,
          },
        ],
      })

      expect(mockTrackChatUpload).toHaveBeenCalledTimes(2)
      expect(payload.context).toEqual([
        {
          type: 'uploaded_file',
          content:
            'File "payroll.xlsx" could not be prepared for Copilot and was omitted. Other attached files remain available.',
        },
        {
          type: 'uploaded_file',
          content: [
            'File "photo.png" (image/png, 10 bytes) uploaded to this chat as "uploads/photo.png" (a chat upload: readable here, not listed under workspace files/).',
            'Read it with sim_cli: {"args":["files","read","uploads/photo.png"]}',
            'Pass the same path "uploads/photo.png" as inputs.files[].path to mount it in run_code or use it as a reference image in generate_image.',
          ].join('\n'),
        },
      ])
    })
  })

  it('emits ONLY the shared ChatRequest contract fields — nothing legacy rides the wire', async () => {
    const payload = await buildCopilotRequestPayload({
      message: 'debug workspace',
      userId: 'user-1',
      userMessageId: '00000000-0000-4000-8000-000000000001',
      mode: 'agent',
      model: 'claude-opus-4-8',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      userTimezone: 'America/Los_Angeles',
      effort: 'max',
      modelSelection: { model: 'gpt-6-astra', fastMode: true },
    })

    expect(payload).toEqual(
      expect.objectContaining({
        message: 'debug workspace',
        userId: 'user-1',
        messageId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '00000000-0000-4000-8000-000000000002',
        mode: 'agent',
        userTimezone: 'America/Los_Angeles',
        effort: 'max',
        modelSelection: { model: 'gpt-6-astra', fastMode: true },
      })
    )
    expect(ChatPayloadSchema.parse(payload).mode).toBe('agent')
    /** Model/provider are server-decided; v2 enforces permissions under the delegation token. */
    for (const legacy of [
      'workspaceContext',
      'vfs',
      'userMetadata',
      'userPermission',
      'model',
      'provider',
      'desktopCapabilities',
      'prefetch',
      'implicitFeedback',
      'commands',
      'workflowName',
      'isHosted',
      'docCompiler',
    ]) {
      expect(payload).not.toHaveProperty(legacy)
    }
  })
})

describe('Assistant payload', () => {
  afterEach(() => vi.mocked(getExposedIntegrationTools).mockReset())
  beforeEach(() => {
    resetEnvFlagsMock()
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockIsOAuthServiceDeploymentAvailable.mockReturnValue(true)
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
    mockSearchApprovals.mockResolvedValue(new Map())
  })
  it('discovers the existing GitHub user lookup tool with a personal credential in live Search', async () => {
    clearIntegrationToolSchemaCacheForTests()
    mockSearchApprovals.mockResolvedValue(new Map([['github', true]]))
    vi.mocked(getExposedIntegrationTools).mockReturnValue([
      {
        toolId: searchUsersV2Tool.id,
        config: searchUsersV2Tool,
        service: 'github',
        operation: 'search_users',
        blockType: 'github_v2',
        owners: [{ service: 'github', blockType: 'github_v2' }],
      },
    ])
    const actualParams = await vi.importActual<typeof import('@/tools/params')>('@/tools/params')
    mockCreateUserToolSchema.mockImplementationOnce(actualParams.createUserToolSchema)
    const tools = await buildIntegrationToolSchemas('github-live-person', {
      schemaSurface: 'copilot',
      personalAccountsOnly: true,
      organizationId: 'org',
    })
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      name: 'github_search_users_v2',
      oauth: { provider: 'github-repositories' },
      input_schema: { required: expect.arrayContaining(['q', 'credentialId']) },
    })
    expect(tools[0].input_schema.properties).not.toHaveProperty('apiKey')
    mockSearchApprovals.mockResolvedValue(new Map([['github', false]]))
    expect(
      await buildIntegrationToolSchemas('github-live-person', {
        schemaSurface: 'copilot',
        personalAccountsOnly: true,
        organizationId: 'org',
      })
    ).toEqual([])
  })
  it('advertises approved personal organization integrations and rechecks revocation', async () => {
    clearIntegrationToolSchemaCacheForTests()
    vi.mocked(getExposedIntegrationTools).mockReturnValue([
      {
        toolId: gmailListLabelsV2Tool.id,
        config: gmailListLabelsV2Tool,
        service: 'gmail',
        operation: 'list_labels',
        blockType: 'gmail',
        owners: [{ service: 'gmail', blockType: 'gmail' }],
      },
    ])
    mockSearchApprovals.mockResolvedValue(new Map([['gmail', true]]))
    const options = {
      schemaSurface: 'copilot' as const,
      personalAccountsOnly: true,
      organizationId: 'org',
    }
    const approved = await buildIntegrationToolSchemas('person', options)
    expect(approved.map((tool) => tool.name)).toEqual(['gmail_list_labels_v2'])
    mockSearchApprovals.mockResolvedValue(new Map([['gmail', false]]))
    expect(await buildIntegrationToolSchemas('person', options)).toEqual([])
    mockSearchApprovals.mockResolvedValue(new Map([['gmail', true]]))
    mockGetUserPermissionConfig.mockResolvedValue({ hideIntegrationsTab: true })
    expect(await buildIntegrationToolSchemas('person', options)).toEqual([])
  })
  it('sends prepared organization images as model-readable attachments without workspace tracking', async () => {
    mockTrackChatUpload.mockClear()
    const image = {
      type: 'image' as const,
      filename: 'image.png',
      source: { type: 'base64' as const, media_type: 'image/png', data: 'aW1hZ2U=' },
    }
    const payload = await buildCopilotRequestPayload({
      message: '',
      userId: 'user-1',
      userMessageId: 'message-1',
      organizationId: 'org-1',
      mode: 'assistant',
      model: '',
      assistantImages: [image],
      fileAttachments: [{ id: 'image', key: 'private-upload', size: 5 }],
    })
    expect(payload.message).toBe('')
    expect(payload.assistantImages).toEqual([image])
    expect(payload).not.toHaveProperty('context')
    expect(payload).not.toHaveProperty('workspaceId')
    expect(mockTrackChatUpload).not.toHaveBeenCalled()
  })

  it('forwards organization scope without workspace, integration, or desktop authority', async () => {
    const payload = await buildCopilotRequestPayload({
      message: 'Find the policy',
      userId: 'user-1',
      userMessageId: 'message-1',
      organizationId: 'org-1',
      mode: 'assistant',
      model: '',
      browser: true,
      terminalCapable: true,
      desktopLocalFilesystem: true,
      desktopLocalFiles: true,
    })
    expect(payload.organizationId).toBe('org-1')
    expect(payload.integrationCatalog).toEqual({ mcpServerIds: [] })
    expect(payload).not.toHaveProperty('workspaceId')
    expect(payload).not.toHaveProperty('desktopCapabilities')
    expect(payload).not.toHaveProperty('integrationTools')
  })

  it('keeps the shared search scope with native discovery and no MCP servers', async () => {
    clearIntegrationToolSchemaCacheForTests()
    const payload = await buildCopilotRequestPayload({
      message: 'Find it and update it',
      userId: 'user-1',
      userMessageId: 'assistant-message',
      mode: 'assistant',
      model: '',
      workspaceId: 'ws-1',
      workflowId: 'forbidden-workflow',
      assistantSearch: { source: 'slack', documentIds: ['document-1'] },
      contexts: [{ type: 'skill', content: 'Build instructions' }],
      commands: ['run_function'],
      mcpServerIds: ['shared-server'],
      desktopLocalFilesystem: true,
      desktopLocalFiles: true,
      browser: true,
      terminalCapable: true,
    })
    expect(payload).not.toHaveProperty('desktop')
    expect(payload.clientCapabilities).toEqual([TOOL_DEADLINE_CAPABILITY])
    expect(payload.mode).toBe('assistant')
    expect(payload.assistantSearch).toEqual({ source: 'slack', documentIds: ['document-1'] })
    for (const field of ['context', 'commands', 'mothershipTools', 'workflowId']) {
      expect(payload).not.toHaveProperty(field)
    }
    expect(payload).not.toHaveProperty('integrationTools')
    expect(payload.integrationCatalog).toEqual({ mcpServerIds: [] })
  })
})

describe('desktop request capabilities', () => {
  it.each([false, true])(
    'rechecks the server rollout for a forged computer capability (enabled=%s)',
    async (enabled) => {
      mockComputerUseAvailable.mockResolvedValueOnce(enabled)
      const payload = await buildCopilotRequestPayload({
        message: 'Use Notes',
        workspaceId: 'workspace',
        userId: 'user',
        principal: { kind: 'session', userId: 'user', sessionId: 'session' },
        userMessageId: 'message',
        mode: 'agent',
        model: 'gpt-6-astra',
        computerUse: true,
      })
      expect(payload.desktop?.computerUse ?? false).toBe(enabled)
    }
  )

  it('preserves desktop capabilities and current session hints on the worker wire', async () => {
    const payload = await buildCopilotRequestPayload({
      message: 'Inspect my local page',
      workspaceId: 'workspace',
      userId: 'user',
      userMessageId: 'message',
      mode: 'ask',
      model: 'gpt-6-astra',
      browser: true,
      terminalCapable: true,
      terminals: [{ id: 'terminal-1', cwd: '/work/app', active: true }],
      browserSessions: [
        { hostname: 'example.com', evidence: 'cookies', lastObservedAt: '2026-09-08' },
      ],
    })
    expect(payload.desktop).toEqual({
      computerUse: false,
      browser: true,
      terminal: true,
      terminals: [{ id: 'terminal-1', cwd: '/work/app', active: true }],
      browserSessions: [
        { hostname: 'example.com', evidence: 'cookies', lastObservedAt: '2026-09-08' },
      ],
    })
  })
  it('advertises native files in org mode independently of browser and terminal', async () => {
    const payload = await buildCopilotRequestPayload({
      message: 'Read and import my report',
      organizationId: 'org-files',
      chatId: 'org-chat',
      userId: 'user',
      userMessageId: 'message',
      mode: 'ask',
      model: 'gpt-6-astra',
      desktopLocalFiles: true,
    })
    expect(payload.desktop).toEqual({
      computerUse: false,
      localFiles: true,
      browser: false,
      terminal: false,
      terminals: [],
      browserSessions: [],
    })
    expect(payload.workspaceId).toBeUndefined()
  })
  it('does not advertise desktop tools for a web-only turn', async () => {
    const payload = await buildCopilotRequestPayload({
      message: 'Hello',
      workspaceId: 'workspace',
      userId: 'user',
      userMessageId: 'message',
      mode: 'ask',
      model: 'gpt-6-astra',
      terminals: [{ id: 'stale-terminal' }],
    })
    expect(payload.desktop).toBeUndefined()
  })
})

it('carries only enabled MCP IDs without eager catalog discovery while preserving desktop capabilities', async () => {
  const { getBlockVisibilityForCopilot } = await import('@/lib/mothership/block-visibility')
  vi.mocked(getBlockVisibilityForCopilot).mockClear()
  const principal = createSessionPrincipal({ userId: 'user-org' })
  const payload = await buildCopilotRequestPayload({
    message: 'Use my tools',
    userId: 'user-org',
    userMessageId: 'message-org',
    organizationId: 'org-catalog',
    chatId: 'chat-org',
    principal,
    mode: 'agent',
    model: '',
    mcpServerIds: ['server-a', 'server-b'],
    browser: true,
    terminalCapable: true,
  })
  expect(getBlockVisibilityForCopilot).not.toHaveBeenCalled()
  expect(payload.integrationCatalog).toEqual({ mcpServerIds: ['server-a', 'server-b'] })
  expect(payload).not.toHaveProperty('integrationTools')
  expect(payload).not.toHaveProperty('mothershipTools')
  expect(payload.desktop).toMatchObject({ browser: true, terminal: true })
})

/** The worker derives both its gateway tools and prompt instructions from this capability. */
it.each([{ organizationId: 'org-1' }, { workspaceId: 'ws-1' }])(
  'switches Search integration capability per turn while preserving Build for %j',
  async (scope) => {
    for (const enabled of [true, false, true]) {
      mockSearchIntegrationToolsEnabled.mockResolvedValue(enabled)
      for (const mode of ['assistant', 'agent', 'plan']) {
        const payload = await buildCopilotRequestPayload({
          message: 'Find a person',
          userId: 'person',
          userMessageId: 'message',
          mode,
          model: '',
          ...scope,
        })
        expect(payload.integrationCatalog).toEqual(
          mode === 'assistant' && !enabled ? undefined : { mcpServerIds: [] }
        )
      }
    }
  }
)
