/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock, workflowsUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'

const {
  mockCreateUserToolSchema,
  mockGetHighestPrioritySubscription,
  mockGetUserPermissionConfig,
  mockIsIntegrationDeploymentAvailable,
  mockIsOAuthServiceDeploymentAvailable,
  mockTrackChatUpload,
  mockSearchApprovals,
} = vi.hoisted(() => ({
  mockCreateUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockIsIntegrationDeploymentAvailable: vi.fn((_blockType: string) => true),
  mockIsOAuthServiceDeploymentAvailable: vi.fn((_providerId: string) => true),
  mockTrackChatUpload: vi.fn(),
  mockSearchApprovals: vi.fn(async () => new Map<string, boolean>()),
}))

// The inventory reads nine application worlds; these suites exercise the request shape, not the reads.
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
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isPaid: vi.fn(
    (plan: string | null) => plan === 'pro' || plan === 'team' || plan === 'enterprise'
  ),
}))

vi.mock('@/lib/mothership/mcp-tools', () => ({
  buildTaggedMcpToolSchemas: vi.fn(async () => []),
  buildOrganizationTaggedMcpToolSchemas: vi.fn(async () => []),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/tools/registry', () => ({
  tools: {
    gmail_send: {
      id: 'gmail_send',
      name: 'Gmail Send',
      description: 'Send emails using Gmail',
      outputs: { messageId: { type: 'string', description: 'Sent message ID' } },
      oauth: { required: true, provider: 'google-email' },
    },
    brandfetch_search: {
      id: 'brandfetch_search',
      name: 'Brandfetch Search',
      description: 'Search for brands by company name',
    },
    // Catalog marks run_workflow as client-routed / clientExecutable; registry ToolConfig has no routing fields.
    run_workflow: {
      id: 'run_workflow',
      name: 'Run Workflow',
      description: 'Run a workflow from the client',
    },
  },
}))

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
  visibilitySignature: vi.fn(() => 'vis:none'),
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

vi.mock('@/tools/metadata', () => ({
  getToolMetadata: (id: string) =>
    id === 'gmail_send'
      ? {
          id,
          params: { accessToken: { type: 'string', visibility: 'hidden', required: true } },
          oauth: { required: true, provider: 'google-email' },
        }
      : undefined,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  trackChatUpload: mockTrackChatUpload,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
  isOAuthServiceDeploymentAvailable: mockIsOAuthServiceDeploymentAvailable,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization: mockGetUserPermissionConfig,
}))

vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  listOrganizationSearchApprovals: mockSearchApprovals,
}))

import {
  buildCopilotRequestPayload,
  buildIntegrationToolSchemas,
  clearIntegrationToolSchemaCacheForTests,
} from '@/lib/mothership/chat/payload'

describe('buildIntegrationToolSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvFlagsMock()
    clearIntegrationToolSchemaCacheForTests()
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
    mockIsOAuthServiceDeploymentAvailable.mockReturnValue(true)
    mockGetUserPermissionConfig.mockResolvedValue(null)
  })

  it('appends the email footer prompt for free users', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)

    const toolSchemas = await buildIntegrationToolSchemas('user-free')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-free')
    expect(gmailTool?.description).toContain('sent with sim ai')
  })

  it('does not append the email footer prompt for paid users', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-paid')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-paid')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
  })

  it('emits executeLocally for dynamic client tools only', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-client')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const runTool = toolSchemas.find((tool) => tool.name === 'run_workflow')

    expect(gmailTool?.executeLocally).toBe(false)
    expect(runTool?.executeLocally).toBe(true)
  })

  it('preserves operation, outputs, and OAuth discovery metadata', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-metadata')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(gmailTool).toEqual(
      expect.objectContaining({
        service: 'gmail',
        operation: 'send',
        outputs: { messageId: { type: 'string', description: 'Sent message ID' } },
        oauth: { required: true, provider: 'google-email' },
      })
    )
  })

  it('uses copilot-facing file schemas for integration tools', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    await buildIntegrationToolSchemas('user-copilot')

    expect(mockCreateUserToolSchema).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gmail_send' }),
      { surface: 'copilot', hostedKeySupport: expect.any(Boolean) }
    )
    expect(mockCreateUserToolSchema).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'brandfetch_search' }),
      { surface: 'copilot', hostedKeySupport: expect.any(Boolean) }
    )
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

  it('briefly reuses built schemas for the same user and surface', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const first = await buildIntegrationToolSchemas('user-cache')
    first[0].input_schema.mutated = true
    if (first[0].outputs) first[0].outputs.mutated = true
    const second = await buildIntegrationToolSchemas('user-cache')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(1)
    expect(mockCreateUserToolSchema).toHaveBeenCalledTimes(3)
    expect(second[0].input_schema).not.toHaveProperty('mutated')
    expect(second[0].outputs).not.toHaveProperty('mutated')
  })

  it('isolates nested schemas and required fields between requests', async () => {
    mockCreateUserToolSchema.mockReturnValueOnce({
      type: 'object',
      properties: { recipients: { type: 'array', items: { type: 'string' } } },
      required: ['recipients'],
    })
    const first = await buildIntegrationToolSchemas('user-nested-schema')
    const properties = first[0].input_schema.properties as Record<string, unknown>
    properties.recipients = { type: 'number' }
    ;(first[0].input_schema.required as string[]).push('forged')

    const second = await buildIntegrationToolSchemas('user-nested-schema')
    expect(second[0].input_schema.properties).toEqual({
      recipients: { type: 'array', items: { type: 'string' } },
    })
    expect(second[0].input_schema.required).toEqual(['recipients'])
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
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(2)
  })

  it('propagates subscription failures without caching a guessed catalog', async () => {
    mockGetHighestPrioritySubscription.mockRejectedValueOnce(new Error('billing unavailable'))
    await expect(buildIntegrationToolSchemas('subscription-failure')).rejects.toThrow(
      'billing unavailable'
    )
    expect(mockCreateUserToolSchema).not.toHaveBeenCalled()
    expect(await buildIntegrationToolSchemas('subscription-failure')).toHaveLength(3)
  })

  it('evicts catalogs by their byte size before reaching the entry cap', async () => {
    mockCreateUserToolSchema.mockImplementation(() => ({
      type: 'object',
      properties: { large: { type: 'string', description: 'x'.repeat(1024 * 1024) } },
    }))
    for (let i = 0; i < 12; i++) await buildIntegrationToolSchemas(`sized-user-${i}`)
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(12)
    await buildIntegrationToolSchemas('sized-user-0')
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(13)
    mockCreateUserToolSchema.mockImplementation(() => ({ type: 'object', properties: {} }))
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrackChatUpload.mockResolvedValue({ displayName: 'payroll.xlsx' })
  })

  it.each(['workspace', 'organization'] as const)(
    'emits contract-valid %s Assistant context with no Build inventory or desktop declaration',
    async (owner) => {
      const payload = await buildCopilotRequestPayload(
        {
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
        },
        { selectedModel: 'legacy-ui-model' }
      )
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
      expect(payload.clientCapabilities).toEqual([])
      if (owner === 'organization') expect(payload).not.toHaveProperty('integrationTools')
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
      await buildCopilotRequestPayload(
        { ...attachmentParams, userPermission: perm },
        { selectedModel: 'claude-opus-4-8' }
      )

      expect(mockTrackChatUpload).not.toHaveBeenCalled()
    })

    it.each(['write', 'admin'])('tracks attachments for permission %s', async (perm) => {
      await buildCopilotRequestPayload(
        { ...attachmentParams, userPermission: perm },
        { selectedModel: 'claude-opus-4-8' }
      )

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
      const payload = await buildCopilotRequestPayload(
        { ...attachmentParams, userPermission: 'write' },
        { selectedModel: 'claude-opus-4-8' }
      )

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

      const payload = await buildCopilotRequestPayload(
        {
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
        },
        { selectedModel: 'claude-opus-4-8' }
      )

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
    const payload = await buildCopilotRequestPayload(
      {
        message: 'debug workspace',
        userId: 'user-1',
        userMessageId: '00000000-0000-4000-8000-000000000001',
        mode: 'agent',
        model: 'claude-opus-4-8',
        workspaceId: '00000000-0000-4000-8000-000000000002',
        userTimezone: 'America/Los_Angeles',
        effort: 'max',
        modelSelection: { model: 'gpt-6-astra', fastMode: true },
      },
      { selectedModel: 'claude-opus-4-8' }
    )

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
      'entitlements',
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
  beforeEach(() => {
    resetEnvFlagsMock()
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockIsOAuthServiceDeploymentAvailable.mockReturnValue(true)
    mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
    mockSearchApprovals.mockResolvedValue(new Map())
  })
  it('advertises approved personal organization integrations and rechecks revocation', async () => {
    mockSearchApprovals.mockResolvedValue(new Map([['gmail', true]]))
    const options = {
      schemaSurface: 'copilot' as const,
      personalAccountsOnly: true,
      organizationId: 'org',
    }
    const approved = await buildIntegrationToolSchemas('person', options)
    expect(approved.map((tool) => tool.name)).toContain('gmail_send')
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
    const payload = await buildCopilotRequestPayload(
      {
        message: '',
        userId: 'user-1',
        userMessageId: 'message-1',
        organizationId: 'org-1',
        mode: 'assistant',
        model: '',
        assistantImages: [image],
        fileAttachments: [{ id: 'image', key: 'private-upload', size: 5 }],
      },
      { selectedModel: '' }
    )
    expect(payload.message).toBe('')
    expect(payload.assistantImages).toEqual([image])
    expect(payload).not.toHaveProperty('context')
    expect(payload).not.toHaveProperty('workspaceId')
    expect(mockTrackChatUpload).not.toHaveBeenCalled()
  })

  it('forwards organization scope without workspace, integration, or desktop authority', async () => {
    const payload = await buildCopilotRequestPayload(
      {
        message: 'Find the policy',
        userId: 'user-1',
        userMessageId: 'message-1',
        organizationId: 'org-1',
        mode: 'assistant',
        model: '',
        browser: true,
        terminalCapable: true,
        desktopLocalFilesystem: true,
      },
      { selectedModel: '' }
    )
    expect(payload.organizationId).toBe('org-1')
    expect(payload).not.toHaveProperty('workspaceId')
    expect(payload).not.toHaveProperty('desktopCapabilities')
    expect(payload.integrationTools ?? []).toEqual([])
  })

  it('keeps the shared search scope and only personally authenticated integrations', async () => {
    clearIntegrationToolSchemaCacheForTests()
    const payload = await buildCopilotRequestPayload(
      {
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
        browser: true,
        terminalCapable: true,
      },
      { selectedModel: '' }
    )
    expect(payload).not.toHaveProperty('desktop')
    expect(payload.clientCapabilities).toEqual([])
    expect(payload.mode).toBe('assistant')
    expect(payload.assistantSearch).toEqual({ source: 'slack', documentIds: ['document-1'] })
    for (const field of ['context', 'commands', 'mothershipTools', 'workflowId']) {
      expect(payload).not.toHaveProperty(field)
    }
    expect(payload.integrationTools).toEqual([
      expect.objectContaining({
        name: 'gmail_send',
        oauth: { required: true, provider: 'google-email' },
      }),
    ])
  })
})

describe('desktop request capabilities', () => {
  it('preserves desktop capabilities and current session hints on the worker wire', async () => {
    const payload = await buildCopilotRequestPayload(
      {
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
      },
      { selectedModel: 'gpt-6-astra' }
    )
    expect(payload.desktop).toEqual({
      browser: true,
      terminal: true,
      terminals: [{ id: 'terminal-1', cwd: '/work/app', active: true }],
      browserSessions: [
        { hostname: 'example.com', evidence: 'cookies', lastObservedAt: '2026-09-08' },
      ],
    })
  })
  it('does not advertise desktop tools for a web-only turn', async () => {
    const payload = await buildCopilotRequestPayload(
      {
        message: 'Hello',
        workspaceId: 'workspace',
        userId: 'user',
        userMessageId: 'message',
        mode: 'ask',
        model: 'gpt-6-astra',
        terminals: [{ id: 'stale-terminal' }],
      },
      { selectedModel: 'gpt-6-astra' }
    )
    expect(payload.desktop).toBeUndefined()
  })
})

it('supplies org visibility and tagged MCP discovery while preserving desktop capabilities', async () => {
  const { getBlockVisibilityForCopilot } = await import('@/lib/mothership/block-visibility')
  const { buildOrganizationTaggedMcpToolSchemas } = await import('@/lib/mothership/mcp-tools')
  const principal = { kind: 'session' as const, userId: 'user-org' }
  const payload = await buildCopilotRequestPayload(
    {
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
    },
    { selectedModel: '' }
  )
  expect(getBlockVisibilityForCopilot).toHaveBeenCalledWith('user-org', undefined, 'org-catalog')
  expect(buildOrganizationTaggedMcpToolSchemas).toHaveBeenCalledWith(
    principal,
    {
      userId: 'user-org',
      organizationId: 'org-catalog',
      chatId: 'chat-org',
    },
    ['server-a', 'server-b']
  )
  expect(payload.desktop).toMatchObject({ browser: true, terminal: true })
})
