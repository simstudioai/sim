/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock, workflowsUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateUserToolSchema,
  mockGetHighestPrioritySubscription,
  mockGetUserPermissionConfig,
  mockIsIntegrationDeploymentAvailable,
  mockIsOAuthServiceDeploymentAvailable,
  mockTrackChatUpload,
} = vi.hoisted(() => ({
  mockCreateUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
  mockIsOAuthServiceDeploymentAvailable: vi.fn(() => true),
  mockTrackChatUpload: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isPaid: vi.fn(
    (plan: string | null) => plan === 'pro' || plan === 'team' || plan === 'enterprise'
  ),
}))

vi.mock('@/lib/mcp/utils', () => ({
  createMcpToolId: vi.fn(),
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

vi.mock('@/tools/utils', () => ({
  getLatestVersionTools: vi.fn((input) => input),
  stripVersionSuffix: vi.fn((toolId: string) => toolId),
}))

vi.mock('@/lib/copilot/block-visibility', () => ({
  getBlockVisibilityForCopilot: vi.fn(async () => ({
    revealed: new Set<string>(),
    disabled: new Set<string>(),
    previewTagged: new Set<string>(),
  })),
  visibilitySignature: vi.fn(() => 'vis:none'),
}))

vi.mock('@/lib/copilot/integration-tools', () => ({
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

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  trackChatUpload: mockTrackChatUpload,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
  isOAuthServiceDeploymentAvailable: mockIsOAuthServiceDeploymentAvailable,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

import {
  buildCopilotRequestPayload,
  buildIntegrationToolSchemas,
  clearIntegrationToolSchemaCacheForTests,
} from './payload'

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

  it('still builds integration tools when subscription lookup fails', async () => {
    mockGetHighestPrioritySubscription.mockRejectedValue(new Error('db unavailable'))

    const toolSchemas = await buildIntegrationToolSchemas('user-error')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const brandfetchTool = toolSchemas.find((tool) => tool.name === 'brandfetch_search')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-error')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
    expect(brandfetchTool?.description).toBe('Search for brands by company name')
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
      undefined,
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
        undefined,
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
})

describe('buildCopilotRequestPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrackChatUpload.mockResolvedValue({ displayName: 'payroll.xlsx' })
  })

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
            'File "payroll.xlsx" (application/octet-stream, 1 bytes) uploaded.',
            'Read with: read("uploads/payroll.xlsx")',
            'To save permanently: save_upload(fileName: "payroll.xlsx")',
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
            'File "photo.png" (image/png, 10 bytes) uploaded.',
            'Read with: read("uploads/photo.png")',
            'To save permanently: save_upload(fileName: "photo.png")',
          ].join('\n'),
        },
      ])
    })
  })

  it('passes workspaceContext through to the Go request payload', async () => {
    const payload = await buildCopilotRequestPayload(
      {
        message: 'debug workspace',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'agent',
        model: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        workspaceContext: 'workspace inventory',
      },
      { selectedModel: 'claude-opus-4-8' }
    )

    expect(payload).toEqual(
      expect.objectContaining({
        workspaceId: 'ws-1',
        workspaceContext: 'workspace inventory',
      })
    )
  })

  it('advertises desktop capabilities without adding parallel local_* tool schemas', async () => {
    const capablePayload = await buildCopilotRequestPayload(
      {
        message: 'inspect my local project',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'agent',
        model: '',
        workspaceId: 'ws-1',
        desktopLocalFilesystem: true,
      },
      { selectedModel: '' }
    )
    expect(capablePayload).toMatchObject({
      desktopCapabilities: { localFilesystem: true },
    })
    expect(capablePayload).not.toHaveProperty('mothershipTools')

    const browserPayload = await buildCopilotRequestPayload(
      {
        message: 'inspect my local project',
        userId: 'user-1',
        userMessageId: 'msg-2',
        mode: 'agent',
        model: '',
        workspaceId: 'ws-1',
        browser: true,
        browserSessions: [
          {
            hostname: 'example.com',
            evidence: 'cookies',
            lastObservedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      { selectedModel: '' }
    )
    expect(browserPayload).not.toHaveProperty('mothershipTools')
    expect(browserPayload).toMatchObject({
      desktopCapabilities: {
        browser: true,
        browserSessions: [
          {
            hostname: 'example.com',
            evidence: 'cookies',
            lastObservedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
    })
    expect(browserPayload).not.toHaveProperty('browserCapable')
  })

  it('passes user metadata through to the Go request payload', async () => {
    const payload = await buildCopilotRequestPayload(
      {
        message: 'what time is it',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'agent',
        model: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        userTimezone: 'America/Los_Angeles',
        userMetadata: {
          name: 'Sid',
          timezone: 'America/Los_Angeles',
        },
      },
      { selectedModel: 'claude-opus-4-8' }
    )

    expect(payload).toEqual(
      expect.objectContaining({
        userTimezone: 'America/Los_Angeles',
        userMetadata: {
          name: 'Sid',
          timezone: 'America/Los_Angeles',
        },
      })
    )
  })

  it('passes entitlements through and omits the field when empty', async () => {
    const withEntitlements = await buildCopilotRequestPayload(
      {
        message: 'publish as a block',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'agent',
        model: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        entitlements: ['custom-blocks'],
      },
      { selectedModel: 'claude-opus-4-8' }
    )
    expect(withEntitlements).toEqual(expect.objectContaining({ entitlements: ['custom-blocks'] }))

    const withoutEntitlements = await buildCopilotRequestPayload(
      {
        message: 'publish as a block',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'agent',
        model: 'claude-opus-4-8',
        workspaceId: 'ws-1',
        entitlements: [],
      },
      { selectedModel: 'claude-opus-4-8' }
    )
    expect(withoutEntitlements).not.toHaveProperty('entitlements')
  })
})
