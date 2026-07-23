/**
 * @vitest-environment node
 */
import { envFlagsMock, workflowsUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateUserToolSchema, mockGetHighestPrioritySubscription } = vi.hoisted(() => ({
  mockCreateUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
  mockGetHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isPaid: vi.fn(
    (plan: string | null) => plan === 'pro' || plan === 'team' || plan === 'enterprise'
  ),
}))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

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
  filterExposedIntegrationTools: vi.fn((tools: unknown[]) => tools),
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
    },
  ]),
}))

vi.mock('@/tools/params', () => ({
  createUserToolSchema: mockCreateUserToolSchema,
}))

import {
  buildCopilotRequestPayload,
  buildIntegrationToolSchemas,
  clearIntegrationToolSchemaCacheForTests,
} from './payload'

describe('buildIntegrationToolSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearIntegrationToolSchemaCacheForTests()
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
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
      },
      { selectedModel: '' }
    )
    expect(browserPayload).not.toHaveProperty('mothershipTools')
    expect(browserPayload).not.toHaveProperty('desktopCapabilities')
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
