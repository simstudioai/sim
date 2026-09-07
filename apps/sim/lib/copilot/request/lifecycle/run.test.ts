/**
 * @vitest-environment node
 */

import { resetEnvFlagsMock, resetEnvironmentUtilsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

afterAll(resetEnvironmentUtilsMock)

const {
  mockCreateRunSegment,
  mockForceFailHungToolCall,
  mockGetMothershipBaseURL,
  mockGetMothershipSourceEnvHeaders,
  mockPrepareCopilotEnvironmentContext,
  mockPrepareExecutionContext,
  mockRunStreamLoop,
  mockPendingToolWaitBudgetMs,
  mockGetAutoAllowedTools,
  mockGetUserPermissionConfig,
  mockFilterModelSafeWorkspaceFileAttachments,
  mockUpdateRunStatus,
  mockEnv,
} = vi.hoisted(() => ({
  mockCreateRunSegment: vi.fn(),
  mockForceFailHungToolCall: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
  mockGetMothershipSourceEnvHeaders: vi.fn(),
  mockPrepareCopilotEnvironmentContext: vi.fn(),
  mockPrepareExecutionContext: vi.fn(),
  mockRunStreamLoop: vi.fn(),
  mockPendingToolWaitBudgetMs: vi.fn((_toolCall?: { name?: string; status?: string }) => 60_000),
  mockGetAutoAllowedTools: vi.fn(async () => new Set<string>()),
  mockGetUserPermissionConfig: vi.fn(async () => null),
  mockFilterModelSafeWorkspaceFileAttachments: vi.fn(async (attachments: unknown[]) => attachments),
  mockUpdateRunStatus: vi.fn(),
  mockEnv: {
    COPILOT_API_KEY: undefined as string | undefined,
    MSHIP_SYSPROMPT_OVERRIDE: undefined as string | undefined,
  },
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  filterModelSafeWorkspaceFileAttachments: (...args: unknown[]) =>
    mockFilterModelSafeWorkspaceFileAttachments(...args),
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: mockCreateRunSegment,
  updateRunStatus: mockUpdateRunStatus,
}))

vi.mock('@/lib/copilot/request/go/stream', () => {
  class CopilotBackendError extends Error {
    status?: number

    constructor(message: string, options?: { status?: number }) {
      super(message)
      this.name = 'CopilotBackendError'
      this.status = options?.status
    }
  }

  class BillingLimitError extends Error {
    userId: string

    constructor(userId: string) {
      super('Usage limit reached')
      this.name = 'BillingLimitError'
      this.userId = userId
    }
  }

  const STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE =
    'The assistant stopped before finishing this turn. The work it already completed has been saved — send a message to continue from there.'

  class StreamEndedWithoutTerminalError extends Error {
    path: string

    constructor(path: string) {
      super(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
      this.name = 'StreamEndedWithoutTerminalError'
      this.path = path
    }
  }

  return {
    BillingLimitError,
    CopilotBackendError,
    STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE,
    StreamEndedWithoutTerminalError,
    runStreamLoop: mockRunStreamLoop,
  }
})

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: mockGetMothershipBaseURL,
  getMothershipSourceEnvHeaders: mockGetMothershipSourceEnvHeaders,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  envBoolean: vi.fn(() => undefined),
  getEnv: vi.fn((key: string) => (key === 'NEXT_PUBLIC_APP_URL' ? 'http://localhost:3000' : '')),
  isTruthy: vi.fn((value: string | undefined) => value === 'true'),
  isFalsy: vi.fn((value: string | undefined) => value === 'false'),
}))

vi.mock('@/lib/copilot/persistence/tool-permission/auto-allow', () => ({
  getAutoAllowedTools: mockGetAutoAllowedTools,
  addAutoAllowedTool: vi.fn(),
  addChatAutoAllowedTool: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

vi.mock('@/lib/copilot/environment-context', () => ({
  prepareCopilotEnvironmentContext: mockPrepareCopilotEnvironmentContext,
}))

vi.mock('@/lib/copilot/tools/handlers/context', () => ({
  prepareExecutionContext: mockPrepareExecutionContext,
}))

vi.mock('@/lib/copilot/request/tools/billing', () => ({
  handleBillingLimitResponse: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/executor', () => ({
  executeToolAndReport: vi.fn(),
  forceFailHungToolCall: mockForceFailHungToolCall,
  pendingToolWaitBudgetMs: mockPendingToolWaitBudgetMs,
}))

import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  CopilotBackendError,
  STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE,
  StreamEndedWithoutTerminalError,
} from '@/lib/copilot/request/go/stream'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'

afterAll(resetEnvFlagsMock)

const SCHEMA_CONTROL_KEYS = [
  '$schema',
  'format',
  'contentEncoding',
  'contentMediaType',
  'type',
] as const

describe('runCopilotLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.COPILOT_API_KEY = undefined
    mockEnv.MSHIP_SYSPROMPT_OVERRIDE = undefined
    setEnvFlags({
      isHosted: false,
      isCopilotToolPermissionsEnabled: false,
    })
    mockGetAutoAllowedTools.mockResolvedValue(new Set<string>())
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockPendingToolWaitBudgetMs.mockImplementation(() => 60_000)
    mockGetMothershipBaseURL.mockResolvedValue('http://mothership.test')
    mockGetMothershipSourceEnvHeaders.mockReturnValue({})
    mockPrepareCopilotEnvironmentContext.mockResolvedValue({
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    })
  })

  it('threads trace provenance through server execution context only', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
    }
    let capturedExecutionContext: ExecutionContext | undefined
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _url: string,
        request: RequestInit,
        _streamingContext: StreamingContext,
        context: ExecutionContext
      ) => {
        capturedExecutionContext = context
        capturedRequestBody = String(request.body)
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-private-context' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(capturedExecutionContext?.resolvedSecretTraceRegistry).toBe(registry)
    expect(capturedRequestBody).not.toContain('resolvedSecretTraceRegistry')
    expect(capturedRequestBody).not.toContain('resolved-secret-provenance')
    expect(executionContext).not.toHaveProperty('resolvedSecretTraceRegistry')
  })

  it('pins Assistant mode and Search scope over a supplied execution context', async () => {
    let captured: ExecutionContext | undefined
    mockRunStreamLoop.mockImplementationOnce(async (_url, _request, _state, context) => {
      captured = context
    })
    const scope = { source: 'slack', documentIds: ['doc-1'] }
    await runCopilotLifecycle(
      { message: 'Summarize', mode: 'assistant', assistantSearch: scope },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: {
          userId: 'user-1',
          workspaceId: 'ws-1',
          workflowId: '',
          requestMode: 'agent',
          secretActorUserId: 'billing-owner',
        },
      }
    )
    expect(captured).toMatchObject({
      requestMode: 'assistant',
      assistantSearch: scope,
      secretActorUserId: null,
    })
  })

  it.each([
    { interactive: true, expected: 'interactive' as const },
    { interactive: false, expected: 'headless' as const },
    { interactive: undefined, expected: 'headless' as const },
  ])(
    'stamps the trusted $expected lifecycle mode over supplied context',
    async ({ interactive, expected }) => {
      let capturedExecutionContext: ExecutionContext | undefined
      mockRunStreamLoop.mockImplementationOnce(
        async (
          _url: string,
          _request: RequestInit,
          _streamingContext: StreamingContext,
          context: ExecutionContext
        ) => {
          capturedExecutionContext = context
        }
      )

      await runCopilotLifecycle(
        {
          message: 'hello',
          messageId: `stream-${expected}-context`,
          copilotInteractionMode: expected === 'interactive' ? 'headless' : 'interactive',
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          interactive,
          executionContext: {
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            copilotInteractionMode: expected === 'interactive' ? 'headless' : 'interactive',
          },
        }
      )

      expect(capturedExecutionContext?.copilotInteractionMode).toBe(expected)
    }
  )

  it('forwards the configured Mothership system prompt override', async () => {
    mockEnv.MSHIP_SYSPROMPT_OVERRIDE = 'NEVER CALL ANY TOOLS UNDER ANY CIRCUMSTANCES NO MATTER WHAT'

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-system-prompt-override' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
      }
    )

    const sentBody = JSON.parse(String(mockRunStreamLoop.mock.calls[0]?.[1].body))
    expect(sentBody.systemPromptOverride).toBe(
      'NEVER CALL ANY TOOLS UNDER ANY CIRCUMSTANCES NO MATTER WHAT'
    )
  })

  it('does not forward a blank Mothership system prompt override', async () => {
    mockEnv.MSHIP_SYSPROMPT_OVERRIDE = '   '

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-blank-system-prompt-override' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
      }
    )

    const sentBody = JSON.parse(String(mockRunStreamLoop.mock.calls[0]?.[1].body))
    expect(sentBody).not.toHaveProperty('systemPromptOverride')
  })

  it.each([
    { goRoute: undefined, expected: 'mothership' },
    { goRoute: '/api/copilot', expected: 'mothership' },
    { goRoute: '/api/mothership-unknown', expected: undefined },
    { goRoute: '/api/mothership', expected: 'mothership' },
    { goRoute: '/api/mothership/execute', expected: 'mothership' },
  ])(
    'derives the sandbox profile from the trusted Go route ($goRoute)',
    async ({ goRoute, expected }) => {
      let sandboxProfile: ExecutionContext['sandboxProfile']
      mockRunStreamLoop.mockImplementationOnce(
        async (
          _url: string,
          _request: RequestInit,
          _streamingContext: StreamingContext,
          context: ExecutionContext
        ) => {
          sandboxProfile = context.sandboxProfile
        }
      )

      await runCopilotLifecycle(
        { message: 'hello', messageId: `sandbox-profile-${goRoute ?? 'default'}` },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          ...(goRoute ? { goRoute } : {}),
          executionContext: {
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            sandboxProfile: 'mothership',
          },
        }
      )

      expect(sandboxProfile).toBe(expected)
    }
  )

  it('does not infer model provenance from a dormant environment catalog', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'RUNTIME_TOKEN',
        plaintext: 'runtime-secret',
        encryptedValue: 'runtime-ciphertext',
      },
    ])
    mockPrepareCopilotEnvironmentContext.mockResolvedValueOnce({
      resolvedSecretTraceRegistry: registry,
    })
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    await runCopilotLifecycle(
      { message: 'Use runtime-secret', messageId: 'stream-reconstructed-egress' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: {
          userId: 'user-1',
          workflowId: '',
          workspaceId: 'ws-1',
        },
      }
    )

    expect(mockPrepareCopilotEnvironmentContext).toHaveBeenCalledWith('user-1', 'ws-1', {
      includeSecrets: true,
    })
    expect(JSON.parse(capturedRequestBody)).toMatchObject({
      message: 'Use runtime-secret',
    })
  })

  it('preserves ordinary initial Go payload fields that collide with a configured secret', async () => {
    const secret = 'mothership-secret'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    const payload = {
      message: `message ${secret} __var_FOREIGN`,
      messages: [{ role: 'user', content: secret }],
      context: [{ type: 'resource', content: secret }],
      contexts: [{ type: 'mcp', content: secret }],
      workspaceContext: `workspace ${secret}`,
      integrationTools: [{ name: 'tool', description: secret }],
      mothershipTools: [{ name: 'mcp', description: '__sim_code_2_binding_0' }],
      fileAttachments: [
        {
          name: `${secret}.txt`,
          key: 'raw-storage-key',
          source: { type: 'base64', data: 'c2FmZQ==' },
        },
      ],
      workspaceId: 'ws-1',
      messageId: 'stream-model-projection',
    }
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    await runCopilotLifecycle(payload, {
      userId: 'user-1',
      workspaceId: 'ws-1',
      executionContext: {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
      },
      resolvedSecretTraceRegistry: registry,
    })

    const { enterpriseByokEligible, ...sent } = JSON.parse(capturedRequestBody)
    expect(enterpriseByokEligible).toBe(false)
    expect(sent).toEqual(payload)
  })

  it('preserves large ordinary tool catalogs without scanning configured secret values', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'catalog-secret', encryptedValue: 'ciphertext' },
    ])
    const toolCount = 4_000
    const propertiesPerTool = 8
    const integrationTools = Array.from({ length: toolCount }, (_, toolIndex) => {
      const properties = Object.fromEntries(
        Array.from({ length: propertiesPerTool }, (_, propertyIndex) => [
          `field_${propertyIndex}`,
          {
            type: 'string',
            description: `Field ${propertyIndex} for tool ${toolIndex}`,
          },
        ])
      )

      return {
        name: `tool_${toolIndex}`,
        description: `Tool ${toolIndex} uses catalog-secret`,
        input_schema: {
          type: 'object',
          properties,
          required: Object.keys(properties),
        },
      }
    })
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    const result = await runCopilotLifecycle(
      {
        message: 'Use the integration catalog',
        messageId: 'stream-large-tool-catalog',
        integrationTools,
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(mockRunStreamLoop).toHaveBeenCalledOnce()
    const sent = JSON.parse(capturedRequestBody)
    expect(sent.integrationTools).toEqual(integrationTools)
  })

  it('preserves ordinary JSON and attachment fields when plaintext overlaps its alias', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOKEN', encryptedValue: 'ciphertext' },
    ])
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    await runCopilotLifecycle(
      {
        message: 'TOKEN',
        messages: [
          {
            role: 'assistant',
            content: 'TOKEN',
            function_call: {
              name: 'legacy-safe',
              arguments: JSON.stringify({ value: 'TOKEN' }),
            },
            tool_calls: [
              {
                id: 'call-safe',
                type: 'function',
                function: {
                  name: 'tool-safe',
                  arguments: JSON.stringify({ value: 'TOKEN' }),
                },
              },
            ],
            files: [{ name: 'TOKEN.txt', context: 'Context TOKEN' }],
          },
        ],
        fileAttachments: [{ name: 'TOKEN.txt', key: 'safe-key' }],
        workspaceId: 'ws-1',
        messageId: 'stream-overlapping-alias',
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: {
          userId: 'user-1',
          workflowId: '',
          workspaceId: 'ws-1',
        },
        resolvedSecretTraceRegistry: registry,
      }
    )

    const sent = JSON.parse(capturedRequestBody)
    expect(sent.message).toBe('TOKEN')
    expect(sent.messages[0]).toMatchObject({
      content: 'TOKEN',
      function_call: { arguments: JSON.stringify({ value: 'TOKEN' }) },
      tool_calls: [
        {
          function: { arguments: JSON.stringify({ value: 'TOKEN' }) },
        },
      ],
      files: [
        {
          name: 'TOKEN.txt',
          context: 'Context TOKEN',
        },
      ],
    })
    expect(sent.fileAttachments).toEqual([{ name: 'TOKEN.txt', key: 'safe-key' }])
  })

  it('omits only unsafe durable attachments before the initial Go request', async () => {
    const unsafe = { id: 'wf-unsafe', name: 'unsafe.txt', key: 'workspace/ws-1/unsafe.txt' }
    const safe = { id: 'wf-safe', name: 'safe.txt', key: 'workspace/ws-1/safe.txt' }
    mockFilterModelSafeWorkspaceFileAttachments.mockResolvedValueOnce([safe])
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    await runCopilotLifecycle(
      {
        message: 'Review files',
        fileAttachments: [unsafe, safe],
        workspaceId: 'ws-1',
        messageId: 'stream-file-provenance',
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
      }
    )

    expect(JSON.parse(capturedRequestBody).fileAttachments).toEqual([safe])
  })

  it('rejects when durable attachment provenance cannot be verified', async () => {
    mockFilterModelSafeWorkspaceFileAttachments.mockRejectedValueOnce(new Error('db unavailable'))

    const result = await runCopilotLifecycle(
      {
        message: 'Continue safely',
        fileAttachments: [{ id: 'wf-file', name: 'file.txt', key: 'workspace/ws-1/file.txt' }],
        workspaceId: 'ws-1',
        messageId: 'stream-file-provenance-failure',
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
      }
    )

    expect(result).toMatchObject({
      success: false,
      error: 'Copilot model input could not be safely projected',
    })
    expect(mockRunStreamLoop).not.toHaveBeenCalled()
  })

  it.each(['123', 'true'])(
    'preserves low-entropy configured-secret collisions across Copilot JSON (%s)',
    async (secret) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      const converted = secret === '123' ? 123 : true
      let capturedRequestBody = ''
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })

      const payload = {
        message: `Message ${secret}`,
        messages: [
          {
            id: secret,
            role: secret,
            name: 'assistant-safe',
            content: `Transcript ${secret}`,
            function_call: {
              name: 'legacy-safe',
              arguments: JSON.stringify({ value: secret, converted }),
            },
            tool_calls: [
              {
                id: secret,
                type: secret,
                function: {
                  name: 'tool-safe',
                  arguments: JSON.stringify({ value: secret, converted }),
                },
              },
            ],
            fileAttachments: [
              {
                id: secret,
                key: secret,
                filename: `${secret}.txt`,
                media_type: secret,
              },
            ],
            contexts: [{ kind: secret, label: `Label ${secret}`, serverId: secret }],
            contentBlocks: [
              {
                type: secret,
                content: `Block ${secret}`,
                toolCall: {
                  id: secret,
                  name: 'nested-tool-safe',
                  state: secret,
                  params: { value: secret },
                  result: { success: true, output: { value: secret, converted } },
                  display: { title: `Title ${secret}` },
                },
              },
            ],
          },
        ],
        context: [
          { type: secret, tag: secret, path: secret, content: `Unsafe ${secret}` },
          {
            type: secret,
            tag: secret,
            path: 'files/safe.txt',
            content: `Context ${secret}`,
          },
        ],
        contexts: [
          {
            kind: secret,
            serverId: secret,
            label: `Context label ${secret}`,
          },
        ],
        integrationTools: [
          {
            name: 'safe_tool',
            description: `Description ${secret}`,
            input_schema: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                  title: `Title ${secret}`,
                  description: `Field ${secret}`,
                  enum: ['public'],
                },
              },
              required: ['value'],
            },
            params: { runtimeControl: secret },
            service: secret,
            operation: secret,
            oauth: { required: true, provider: secret },
          },
          {
            name: 'unsafe_schema_tool',
            description: 'Unsafe schema',
            input_schema: {
              type: 'object',
              properties: { [secret]: { type: 'string' } },
              required: [secret],
            },
          },
          {
            name: secret,
            description: 'Unsafe name',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
        ],
        responseFormat: {
          name: 'safe_response',
          schema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                description: `Result ${secret}`,
                enum: ['public'],
              },
            },
            required: ['value'],
          },
        },
        fileAttachments: [
          {
            id: secret,
            name: `${secret}.txt`,
            key: secret,
            mimeType: secret,
          },
        ],
        vfs: {
          workspace: { id: secret, ownerId: secret, name: `Workspace ${secret}` },
          files: [
            {
              id: secret,
              path: secret,
              folderPath: secret,
              type: secret,
              name: `File ${secret}`,
            },
            {
              id: 'safe-file-id',
              path: 'files/safe.txt',
              folderPath: 'files',
              type: 'text/plain',
              name: `Safe ${secret}`,
            },
          ],
          mcpServers: [
            { id: secret, name: `Unsafe ${secret}`, url: `https://${secret}.example` },
            {
              id: 'safe-mcp-id',
              name: `Safe MCP ${secret}`,
              url: 'https://mcp.example',
            },
          ],
        },
        userTimezone: secret,
        userMetadata: {
          name: `User ${secret}`,
          email: `owner+${secret}@example.com`,
          timezone: secret,
        },
        desktopCapabilities: {
          terminal: true,
          terminals: [
            {
              id: secret,
              cwd: `/workspace/${secret}`,
              running: `command ${secret}`,
              active: true,
            },
            {
              id: 'safe-terminal-id',
              cwd: '/workspace/safe',
              running: `safe command ${secret}`,
              active: true,
            },
          ],
          browser: true,
          browserSessions: [
            { hostname: secret, evidence: 'cookies', lastObservedAt: '2026-01-01T00:00:00.000Z' },
            {
              hostname: 'safe.example',
              evidence: 'sign-in-completed',
              lastObservedAt: '2026-02-01T00:00:00.000Z',
            },
          ],
        },
        workspaceId: 'ws-1',
        messageId: `stream-low-entropy-${secret}`,
      }

      await runCopilotLifecycle(payload, {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: {
          userId: 'user-1',
          workflowId: '',
          workspaceId: 'ws-1',
        },
        resolvedSecretTraceRegistry: registry,
      })

      const { enterpriseByokEligible, ...sent } = JSON.parse(capturedRequestBody)
      expect(enterpriseByokEligible).toBe(false)
      expect(sent).toEqual(payload)
    }
  )

  it.each(SCHEMA_CONTROL_KEYS)(
    'preserves ordinary %s schema controls without scanning configured secret values',
    async (controlKey) => {
      const secret = `copilot-schema-control-secret-${controlKey}`
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      const schema = {
        type: 'object',
        properties: {},
        [controlKey]: secret,
      }
      const integrationTools = [
        {
          name: 'schema_tool',
          description: 'Schema with an ordinary configured-secret collision',
          input_schema: schema,
        },
        {
          name: 'safe_tool',
          description: 'Safe schema',
          input_schema: { type: 'object', properties: {} },
        },
      ]
      let capturedRequestBody = ''
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })

      await runCopilotLifecycle(
        {
          message: 'Use a safe tool',
          messageId: `stream-schema-tool-${controlKey}`,
          integrationTools,
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(JSON.parse(capturedRequestBody).integrationTools).toEqual(integrationTools)

      mockRunStreamLoop.mockClear()
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })
      const result = await runCopilotLifecycle(
        {
          message: 'Use a response schema',
          messageId: `stream-schema-response-${controlKey}`,
          responseFormat: { name: 'ordinary_response', schema },
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(result.success).toBe(true)
      expect(JSON.parse(capturedRequestBody).responseFormat).toEqual({
        name: 'ordinary_response',
        schema,
      })
      expect(mockRunStreamLoop).toHaveBeenCalledOnce()
    }
  )

  it('does not couple optional Copilot response schemas to secret provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    for (const [index, schema] of [
      { properties: { field: 'not-a-schema' } },
      { allOf: new Array(100_001) },
    ].entries()) {
      let capturedRequestBody = ''
      mockRunStreamLoop.mockClear()
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })

      const result = await runCopilotLifecycle(
        {
          message: 'Continue safely',
          messageId: `stream-malformed-response-${index}`,
          responseFormat: { name: 'unsafe_response', schema },
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(result.success).toBe(true)
      expect(JSON.stringify(JSON.parse(capturedRequestBody).responseFormat)).toBe(
        JSON.stringify({ name: 'unsafe_response', schema })
      )
      expect(mockRunStreamLoop).toHaveBeenCalledOnce()
    }
  })

  it.each([
    ['string', { type: 'string' }],
    ['true', { type: 'object', nullable: true }],
  ])(
    'preserves validated canonical schema controls when an active secret has value %s',
    async (secret, schema) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', secret)
      let capturedRequestBody = ''
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })

      await runCopilotLifecycle(
        {
          message: 'Use a safe tool',
          messageId: `stream-canonical-tool-${secret}`,
          integrationTools: [
            {
              name: 'unsafe_tool',
              description: 'Unsafe canonical control',
              input_schema: schema,
            },
            {
              name: 'safe_tool',
              description: 'Safe schema',
              input_schema: { type: 'object', properties: {} },
            },
          ],
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(JSON.parse(capturedRequestBody).integrationTools).toEqual([
        expect.objectContaining({ name: 'unsafe_tool', input_schema: schema }),
        expect.objectContaining({ name: 'safe_tool' }),
      ])

      mockRunStreamLoop.mockClear()
      mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
        capturedRequestBody = String(request.body)
      })
      const result = await runCopilotLifecycle(
        {
          message: 'Use a response schema',
          messageId: `stream-canonical-response-${secret}`,
          responseFormat: { name: 'unsafe_response', schema },
        },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(result.success).toBe(true)
      expect(JSON.parse(capturedRequestBody).responseFormat.schema).toEqual(schema)
      expect(mockRunStreamLoop).toHaveBeenCalledOnce()
    }
  )

  it('forwards safe canonical schema controls byte-for-byte to Copilot', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'unrelated-secret', encryptedValue: 'ciphertext' },
    ])
    const schema = {
      type: ['object', 'null'],
      nullable: true,
      readOnly: false,
      properties: { value: { type: 'string' } },
    }
    let capturedRequestBody = ''
    mockRunStreamLoop.mockImplementationOnce(async (_url: string, request: RequestInit) => {
      capturedRequestBody = String(request.body)
    })

    await runCopilotLifecycle(
      {
        message: 'Use a safe response schema',
        messageId: 'stream-safe-canonical-response',
        responseFormat: { name: 'safe_response', schema },
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' },
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(JSON.parse(capturedRequestBody).responseFormat.schema).toEqual(schema)
  })

  it('does not block ordinary initial Go payloads on unrelated incomplete provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')

    const result = await runCopilotLifecycle(
      { message: 'possibly secret', messageId: 'stream-incomplete-projection' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        executionContext: {
          userId: 'user-1',
          workflowId: '',
          workspaceId: 'ws-1',
        },
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(JSON.parse(String(mockRunStreamLoop.mock.calls[0]?.[1].body))).toMatchObject({
      message: 'possibly secret',
      messageId: 'stream-incomplete-projection',
    })
    expect(mockRunStreamLoop).toHaveBeenCalledOnce()
  })

  describe('tool permission feature flag', () => {
    const runMothershipTurn = () =>
      runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-flag' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          goRoute: '/api/mothership',
          executionContext: {
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            chatId: 'chat-1',
          },
        }
      )

    it('stays entirely inert while the flag is off', async () => {
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(captured?.toolPermissions.enabled).toBe(false)
      // Never even reads the preference tables when disabled.
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })

    it('arms the gate and loads the allow list once the flag is on', async () => {
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      mockGetAutoAllowedTools.mockResolvedValue(new Set(['terminal_run']))
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(captured?.toolPermissions.enabled).toBe(true)
      expect(captured?.toolPermissions.autoAllowed.has('terminal_run')).toBe(true)
      expect(mockGetAutoAllowedTools).toHaveBeenCalledWith('user-1', 'chat-1')
    })

    /**
     * The gate itself stays armed — every call still prompts. Only the memory
     * that would silence it is withheld, and the stored list is not read at
     * all, so an entry saved before the key was set cannot outlive it.
     */
    it('arms the gate but ignores stored auto-allows when the group withholds them', async () => {
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      mockGetUserPermissionConfig.mockResolvedValue({ disableToolAutoApproval: true })
      mockGetAutoAllowedTools.mockResolvedValue(new Set(['terminal_run']))
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(captured?.toolPermissions.enabled).toBe(true)
      expect(captured?.toolPermissions.autoAllowPermitted).toBe(false)
      expect(captured?.toolPermissions.autoAllowed.size).toBe(0)
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })

    /**
     * A failed lookup is the endpoint's reading — withheld — not a rejection.
     * Letting it throw would abort the turn before any card is drawn, over a
     * database hiccup, on the one surface that has a human to ask.
     */
    it('reads a failed capability lookup as withheld instead of aborting the turn', async () => {
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      mockGetUserPermissionConfig.mockRejectedValue(new Error('permission group lookup failed'))
      mockGetAutoAllowedTools.mockResolvedValue(new Set(['terminal_run']))
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(mockRunStreamLoop).toHaveBeenCalledOnce()
      expect(captured?.toolPermissions.enabled).toBe(true)
      expect(captured?.toolPermissions.autoAllowPermitted).toBe(false)
      expect(captured?.toolPermissions.autoAllowed.size).toBe(0)
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })

    it('stays off for the workflow-scoped copilot even with the flag on', async () => {
      // That panel has no permission card, so gating there would hang the turn
      // on a prompt nothing draws.
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-flag-2' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          goRoute: '/api/copilot',
          executionContext: {
            userId: 'user-1',
            workflowId: 'wf-1',
            workspaceId: 'ws-1',
            chatId: 'chat-1',
          },
        }
      )

      expect(captured?.toolPermissions.enabled).toBe(false)
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })
  })

  it('runs cancelled completion persistence when a stream throws after abort', async () => {
    const abortController = new AbortController()
    abortController.abort('stop')
    const onComplete = vi.fn()
    const onError = vi.fn()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'partial answer'
        context.contentBlocks.push({
          type: 'text',
          content: 'partial answer',
          timestamp: 1,
        })
        throw new Error('publisher closed after stop')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        abortSignal: abortController.signal,
        executionContext,
        onComplete,
        onError,
      }
    )

    expect(onError).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        chatId: 'chat-1',
        requestId: undefined,
        error: 'publisher closed after stop',
        contentBlocks: [
          expect.objectContaining({
            type: 'text',
            content: 'partial answer',
          }),
        ],
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        chatId: 'chat-1',
        error: 'publisher closed after stop',
      })
    )
  })

  it('returns the cancelled result when cancelled completion persistence fails', async () => {
    const abortController = new AbortController()
    abortController.abort('stop')
    const onComplete = vi.fn().mockRejectedValue(new Error('db unavailable'))
    const onError = vi.fn()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'partial answer'
        throw new Error('publisher closed after stop')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        abortSignal: abortController.signal,
        executionContext,
        onComplete,
        onError,
      }
    )

    expect(onError).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        error: 'publisher closed after stop',
      })
    )
  })

  it('uses the final post-tool assistant content for headless results', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'I will check that.Final answer only.'
        context.finalAssistantContent = 'Final answer only.'
        context.sawMainToolCall = true
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
        interactive: false,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        content: 'Final answer only.',
      })
    )
  })

  it('does not fall back to pre-tool narration when headless final content is empty', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'I will check that.'
        context.finalAssistantContent = ''
        context.sawMainToolCall = true
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
        interactive: false,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        content: '',
      })
    )
  })

  it('does not trust payload userPermission when building the execution context', async () => {
    let capturedExecContext: ExecutionContext | undefined
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        _context: StreamingContext,
        execContext: ExecutionContext
      ): Promise<void> => {
        capturedExecContext = execContext
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1', userPermission: 'write' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }
    )

    expect(capturedExecContext).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      })
    )
    expect(capturedExecContext).not.toHaveProperty('userPermission')
  })

  it('uses only the trusted lifecycle userPermission option', async () => {
    let capturedExecContext: ExecutionContext | undefined
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        _context: StreamingContext,
        execContext: ExecutionContext
      ): Promise<void> => {
        capturedExecContext = execContext
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1', userPermission: 'admin' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        userPermission: 'read',
      }
    )

    expect(capturedExecContext?.userPermission).toBe('read')
  })

  it.each([
    { workspaceId: 'ws-1', organizationId: undefined },
    { workspaceId: undefined, organizationId: 'org-1' },
  ])('uses immutable attribution on initial and resume legs for %j', async (owner) => {
    const billingAttribution = {
      actorUserId: 'user-1',
      workspaceId: owner.workspaceId ?? null,
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      billingEntity: { type: 'organization' as const, id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    setEnvFlags({ isHosted: true })
    mockEnv.COPILOT_API_KEY = 'sim-agent-key'
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )
    mockRunStreamLoop.mockResolvedValueOnce(undefined)

    await runCopilotLifecycle(
      {
        message: 'hello',
        ...(owner.organizationId ? { mode: 'assistant' } : {}),
        messageId: 'message-1',
        billingRequestId: 'caller-controlled',
      },
      {
        userId: 'user-1',
        ...owner,
        chatId: 'chat-1',
        executionId: 'execution-1',
        runId: 'run-1',
        simRequestId: 'request-1',
        billingAttribution,
      }
    )

    const firstHeaders = mockRunStreamLoop.mock.calls[0]?.[1].headers as Record<string, string>
    const billingRequestId = firstHeaders['x-sim-billing-request-id']
    expect(billingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(billingRequestId).not.toBe('caller-controlled')

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    for (const call of mockRunStreamLoop.mock.calls) {
      const body = JSON.parse(String(call[1].body))
      expect(body).toMatchObject(
        owner.organizationId
          ? { organizationId: owner.organizationId }
          : { workspaceId: owner.workspaceId }
      )
      if (owner.organizationId) expect(body).not.toHaveProperty('workspaceId')
      const headers = call[1].headers as Record<string, string>
      expect(headers).toMatchObject({
        'x-api-key': 'sim-agent-key',
        'x-sim-billing-protocol': 'attribution-v1',
        'x-sim-billing-request-id': billingRequestId,
      })
      expect(JSON.parse(decodeURIComponent(headers['x-sim-billing-attribution']))).toEqual(
        billingAttribution
      )
    }
  })

  it('preserves a resume tool name that collides with a configured secret', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'unsafe-tool', encryptedValue: 'ciphertext' },
    ])
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'unsafe-tool',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: {} },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'message-unsafe-resume-name' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(mockRunStreamLoop.mock.calls[1]?.[1].body))).toMatchObject({
      results: [{ callId: 'tool-1', name: 'unsafe-tool', success: true }],
    })
  })

  it('rejects hosted work without immutable billing attribution before egress', async () => {
    setEnvFlags({ isHosted: true })

    await expect(
      runCopilotLifecycle(
        { message: 'hello', messageId: 'message-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
        }
      )
    ).rejects.toThrow('Billing attribution is required for hosted Copilot execution')
    expect(mockRunStreamLoop).not.toHaveBeenCalled()
  })

  it('does not emit trusted billing headers for a non-hosted lifecycle', async () => {
    mockEnv.COPILOT_API_KEY = 'user-or-self-hosted-key'

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'message-1', billingRequestId: 'caller-controlled' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'ws-1',
          billedAccountUserId: 'owner-1',
          organizationId: null,
          billingEntity: { type: 'user', id: 'owner-1' },
          billingPeriod: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          },
          payerSubscription: null,
        },
      }
    )

    const headers = mockRunStreamLoop.mock.calls[0]?.[1].headers as Record<string, string>
    expect(headers['x-sim-billing-protocol']).toBeUndefined()
    expect(headers['x-sim-billing-request-id']).toBeUndefined()
    expect(headers['x-sim-billing-attribution']).toBeUndefined()
  })

  it('normalizes the initial request body with workspaceId from lifecycle options', async () => {
    let requestBody: Record<string, unknown> | undefined
    mockRunStreamLoop.mockImplementationOnce(
      async (_fetchUrl: string, fetchOptions: RequestInit): Promise<void> => {
        requestBody = JSON.parse(String(fetchOptions.body))
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }
    )

    expect(requestBody).toEqual(
      expect.objectContaining({
        workspaceId: 'ws-1',
      })
    )
  })

  it('uses the lifecycle workspaceId for async tool resume requests', async () => {
    const requestBodies: Record<string, unknown>[] = []
    const fetchUrls: string[] = []
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        fetchUrls.push(fetchUrl)
        requestBodies.push(JSON.parse(String(fetchOptions.body)))
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )
    mockRunStreamLoop.mockImplementationOnce(
      async (fetchUrl: string, fetchOptions: RequestInit): Promise<void> => {
        fetchUrls.push(fetchUrl)
        requestBodies.push(JSON.parse(String(fetchOptions.body)))
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
    expect(requestBodies[1]).toEqual(
      expect.objectContaining({
        checkpointId: 'ckpt-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      })
    )
  })

  it('finalizes as success when a resume fails with a retryable error then the retry succeeds', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    // 1) Initial stream pauses on an async tool checkpoint with a resolved
    //    tool result, so the lifecycle transitions into a resume leg.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    // 2) First resume leg is refused before the backend takes it: it records an
    //    error AND throws a retryable 5xx, which releases the claim in Go.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.errors.push('Copilot backend error (503): service unavailable')
        throw new CopilotBackendError('Copilot backend error (503): service unavailable', {
          status: 503,
        })
      }
    )

    // 3) Retry of the same resume leg succeeds cleanly.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'Recovered final answer.'
        context.finalAssistantContent = 'Recovered final answer.'
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    // Three legs ran (initial + failed resume + retried resume), and the
    // recovered retry must NOT inherit the failed attempt's error.
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(3)
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        errors: undefined,
      })
    )
  })

  it('does not promise Go a transparent stream-error retry it will not perform', async () => {
    const bodies: Record<string, unknown>[] = []
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    // Initial leg pauses on a resolved async tool checkpoint → enters resume.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        bodies.push(JSON.parse(String(fetchOptions.body)))
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    // Three resume attempts, all failing with a retryable 5xx so the loop
    // exhausts MAX_RESUME_ATTEMPTS (= 3) and gives up.
    for (let i = 0; i < 3; i++) {
      mockRunStreamLoop.mockImplementationOnce(
        async (
          _fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.errors.push('Copilot backend error (503): service unavailable')
          throw new CopilotBackendError('Copilot backend error (503): service unavailable', {
            status: 503,
          })
        }
      )
    }

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    // Initial + 3 resume attempts: a 5xx is still transient, so the bounded
    // retry budget is unchanged.
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(4)
    // No leg claims a transparent retry. The flag made Go swallow the error tag
    // that explains the failure, and a stream error is never retried now.
    for (const body of bodies) {
      expect(body.willRetryOnStreamError).toBeUndefined()
    }
  })

  it('retries an initial stream that ended before its checkpoint pause with one request identity', async () => {
    const headers: Array<Record<string, string>> = []
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        headers.push(fetchOptions.headers as Record<string, string>)
        context.errors.push(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
        throw new StreamEndedWithoutTerminalError('/api/mothership')
      }
    )
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        headers.push(fetchOptions.headers as Record<string, string>)
        context.streamComplete = true
        context.completionStatus = MothershipStreamV1CompletionStatus.complete
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-initial-retry' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        simRequestId: 'request-initial-retry',
        executionContext,
      }
    )

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    expect(headers.map((value) => value['X-Sim-Request-ID'])).toEqual([
      'request-initial-retry',
      'request-initial-retry',
    ])
    expect(result).toEqual(
      expect.objectContaining({ success: true, cancelled: false, errors: undefined })
    )
  })

  it('does not retry a resume leg the backend already claimed and ended early', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    // The resume leg is answered with 200 and then ends without a terminal
    // event — the backend has claimed the checkpoint and reported its outcome,
    // so re-posting it would only reproduce and re-bill the same failure.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'Moved the files and updated the workflow.'
        context.errors.push(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
        throw new StreamEndedWithoutTerminalError('/api/tools/resume')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBe(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
    // Everything that streamed before the leg died is still the user's answer.
    expect(result.content).toBe('Moved the files and updated the workflow.')
  })

  it('resolves the turn normally when the backend completes it after an in-band failure', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.errors.push('Subagent build failed: workflow validation error')
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'The build step failed; here is what I changed anyway.'
        context.completionStatus = MothershipStreamV1CompletionStatus.complete
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        content: 'The build step failed; here is what I changed anyway.',
        errors: undefined,
      })
    )
  })

  it('keeps the request failed when the backend terminates the turn as an error', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.errors.push('The provider is overloaded')
        context.completionStatus = MothershipStreamV1CompletionStatus.error
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    expect(result.success).toBe(false)
    expect(result.errors).toEqual(['The provider is overloaded'])
  })

  it('force-fails a hung tool promise and resumes with an error result instead of wedging', async () => {
    vi.useFakeTimers()
    try {
      const fetchUrls: string[] = []
      const bodies: Record<string, unknown>[] = []
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }

      // Mirror the real helper: settle the tool call into a terminal error
      // state so the resume loop can serialize an error result for it.
      mockForceFailHungToolCall.mockImplementation(
        async (toolCallId: string, context: StreamingContext, message: string) => {
          const tool = context.toolCalls.get(toolCallId)
          if (!tool) return
          tool.status = MothershipStreamV1ToolOutcome.error
          tool.endTime = Date.now()
          tool.result = { success: false }
          tool.error = message
        }
      )

      // Initial leg checkpoints on an async tool whose promise NEVER settles —
      // the exact shape of the prod incident (claimed, marked running, hung).
      mockRunStreamLoop.mockImplementationOnce(
        async (
          fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          fetchUrls.push(fetchUrl)
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.toolCalls.set('tool-hung', {
            id: 'tool-hung',
            name: 'read',
            status: 'executing',
          })
          context.pendingToolPromises.set('tool-hung', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: ['tool-hung'],
          }
        }
      )

      // Resume leg completes normally with the error result delivered.
      mockRunStreamLoop.mockImplementationOnce(
        async (
          fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          fetchUrls.push(fetchUrl)
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.accumulatedContent = 'The file read failed, but here is what I know.'
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
        }
      )

      // Wait budget = watchdog (60s, mocked) + resume grace (30s). Advance past it.
      await vi.advanceTimersByTimeAsync(91_000)
      const result = await lifecycle

      expect(mockForceFailHungToolCall).toHaveBeenCalledWith(
        'tool-hung',
        expect.anything(),
        expect.stringContaining('hung')
      )
      expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
      expect(bodies[1].results).toEqual([
        expect.objectContaining({
          callId: 'tool-hung',
          name: 'read',
          success: false,
          data: { error: expect.stringContaining('hung') },
        }),
      ])
      expect(result.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels promptly while a sequential tool promise remains unsettled', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const fetchUrls: string[] = []
      let capturedContext: StreamingContext | null = null
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }

      mockPendingToolWaitBudgetMs.mockReturnValue(3_600_000)
      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          capturedContext = context
          context.toolCalls.set('tool-hung', {
            id: 'tool-hung',
            name: 'terminal',
            status: 'awaiting_approval',
          })
          context.pendingToolPromises.set('tool-hung', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: ['tool-hung'],
          }
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-aborted-tool-wait' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
          abortSignal: controller.signal,
        }
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(mockPendingToolWaitBudgetMs).toHaveBeenCalled()
      controller.abort('user_stop')
      await vi.advanceTimersByTimeAsync(0)
      const result = await lifecycle

      expect(result.success).toBe(false)
      expect(result.cancelled).toBe(true)
      expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])
      expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
      expect(capturedContext?.toolCalls.get('tool-hung')).toMatchObject({
        status: MothershipStreamV1ToolOutcome.cancelled,
        error: 'Stopped by user',
      })

      await vi.advanceTimersByTimeAsync(3_700_000)
      expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
      expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-fails each hung tool on its own budget while awaiting a long approval', async () => {
    vi.useFakeTimers()
    try {
      let releaseApproval = () => {}
      let lifecycleSettled = false
      const fetchUrls: string[] = []
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }

      mockPendingToolWaitBudgetMs.mockImplementation((toolCall) =>
        toolCall?.status === 'awaiting_approval' ? 3_600_000 : 60_000
      )
      mockForceFailHungToolCall.mockImplementation(
        async (toolCallId: string, context: StreamingContext, message: string) => {
          const tool = context.toolCalls.get(toolCallId)
          if (!tool) return
          tool.status = MothershipStreamV1ToolOutcome.error
          tool.endTime = Date.now()
          tool.result = { success: false }
          tool.error = message
        }
      )

      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          const approvalId = 'tool-approval'
          context.toolCalls.set(approvalId, {
            id: approvalId,
            name: 'terminal',
            status: 'awaiting_approval',
          })
          context.pendingToolPromises.set(
            approvalId,
            new Promise<{ status: 'success' }>((resolve) => {
              releaseApproval = () => {
                const tool = context.toolCalls.get(approvalId)
                if (tool) {
                  tool.status = MothershipStreamV1ToolOutcome.success
                  tool.endTime = Date.now()
                  tool.result = { success: true, output: { approved: true } }
                }
                context.pendingToolPromises.delete(approvalId)
                resolve({ status: 'success' })
              }
            })
          )
          context.toolCalls.set('tool-hung', {
            id: 'tool-hung',
            name: 'read',
            status: 'executing',
          })
          context.pendingToolPromises.set('tool-hung', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: [approvalId, 'tool-hung'],
          }
        }
      )
      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          context.accumulatedContent = 'Continued after approval.'
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
        }
      ).finally(() => {
        lifecycleSettled = true
      })

      await vi.advanceTimersByTimeAsync(91_000)
      expect(mockForceFailHungToolCall).toHaveBeenCalledTimes(1)
      expect(mockForceFailHungToolCall).toHaveBeenCalledWith(
        'tool-hung',
        expect.anything(),
        expect.stringContaining('hung')
      )
      expect(lifecycleSettled).toBe(false)
      expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])

      releaseApproval()
      await vi.advanceTimersByTimeAsync(0)
      const result = await lifecycle

      expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
      expect(result.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a stale watchdog fail or delete a replacement promise', async () => {
    vi.useFakeTimers()
    try {
      let capturedContext: StreamingContext | null = null
      let releaseReplacement = () => {}
      let lifecycleSettled = false
      const fetchUrls: string[] = []
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }

      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          capturedContext = context
          context.toolCalls.set('tool-replaced', {
            id: 'tool-replaced',
            name: 'read',
            status: 'executing',
          })
          context.pendingToolPromises.set('tool-replaced', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: ['tool-replaced'],
          }
        }
      )
      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          context.accumulatedContent = 'Continued after the replacement completed.'
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
        }
      ).finally(() => {
        lifecycleSettled = true
      })

      await vi.advanceTimersByTimeAsync(0)
      if (!capturedContext) throw new Error('Initial stream did not establish its context')
      const context: StreamingContext = capturedContext
      const replacement = new Promise<{ status: 'success' }>((resolve) => {
        releaseReplacement = () => {
          const tool = context.toolCalls.get('tool-replaced')
          if (tool) {
            tool.status = MothershipStreamV1ToolOutcome.success
            tool.endTime = Date.now()
            tool.result = { success: true, output: { replacement: true } }
          }
          context.pendingToolPromises.delete('tool-replaced')
          resolve({ status: 'success' })
        }
      })
      context.pendingToolPromises.set('tool-replaced', replacement)

      await vi.advanceTimersByTimeAsync(91_000)
      expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
      expect(context.pendingToolPromises.get('tool-replaced')).toBe(replacement)
      expect(lifecycleSettled).toBe(false)
      expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])

      releaseReplacement()
      await vi.advanceTimersByTimeAsync(0)
      const result = await lifecycle

      expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
      expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
      expect(result.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a replaced short promise without waiting for a parallel long approval', async () => {
    vi.useFakeTimers()
    try {
      let capturedContext: StreamingContext | null = null
      let releaseApproval = () => {}
      let lifecycleSettled = false
      const fetchUrls: string[] = []
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }

      mockPendingToolWaitBudgetMs.mockImplementation((toolCall) =>
        toolCall?.status === 'awaiting_approval' ? 3_600_000 : 60_000
      )
      mockForceFailHungToolCall.mockImplementation(
        async (toolCallId: string, context: StreamingContext, message: string) => {
          const tool = context.toolCalls.get(toolCallId)
          if (!tool) return
          tool.status = MothershipStreamV1ToolOutcome.error
          tool.endTime = Date.now()
          tool.result = { success: false }
          tool.error = message
        }
      )

      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          capturedContext = context
          context.toolCalls.set('tool-approval', {
            id: 'tool-approval',
            name: 'terminal',
            status: 'awaiting_approval',
          })
          context.pendingToolPromises.set(
            'tool-approval',
            new Promise<{ status: 'success' }>((resolve) => {
              releaseApproval = () => {
                const tool = context.toolCalls.get('tool-approval')
                if (tool) {
                  tool.status = MothershipStreamV1ToolOutcome.success
                  tool.endTime = Date.now()
                  tool.result = { success: true, output: { approved: true } }
                }
                context.pendingToolPromises.delete('tool-approval')
                resolve({ status: 'success' })
              }
            })
          )
          context.toolCalls.set('tool-replaced', {
            id: 'tool-replaced',
            name: 'read',
            status: 'executing',
          })
          context.pendingToolPromises.set('tool-replaced', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: ['tool-approval', 'tool-replaced'],
          }
        }
      )
      mockRunStreamLoop.mockImplementationOnce(
        async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
          fetchUrls.push(fetchUrl)
          context.accumulatedContent = 'Continued after approval.'
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
        }
      ).finally(() => {
        lifecycleSettled = true
      })

      await vi.advanceTimersByTimeAsync(0)
      if (!capturedContext) throw new Error('Initial stream did not establish its context')
      const context: StreamingContext = capturedContext
      context.pendingToolPromises.set('tool-replaced', new Promise(() => {}))

      await vi.advanceTimersByTimeAsync(91_000)
      expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
      expect(lifecycleSettled).toBe(false)

      await vi.advanceTimersByTimeAsync(90_000)
      expect(mockForceFailHungToolCall).toHaveBeenCalledTimes(1)
      expect(mockForceFailHungToolCall).toHaveBeenCalledWith(
        'tool-replaced',
        expect.anything(),
        expect.stringContaining('hung')
      )
      expect(lifecycleSettled).toBe(false)
      expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])

      releaseApproval()
      await vi.advanceTimersByTimeAsync(0)
      const result = await lifecycle

      expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
      expect(result.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes the turn when a pending subagent tool has no result', async () => {
    // A tool that never reached a terminal state used to throw
    // "Cannot resume subagent chain ...: missing result for tool call ...",
    // which inside a fanout cancelled every sibling lane and reported the whole
    // request as an error blaming an unrelated tool. Synthesize the failure Go
    // already writes for itself instead, and let the turn finish.
    const bodies: Array<Record<string, unknown>> = []
    mockRunStreamLoop.mockImplementation(
      async (
        fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        if (!fetchUrl.includes('/api/tools/resume')) {
          context.awaitingAsyncContinuation = {
            checkpointId: 'cp-root',
            pendingToolCallIds: [],
            frames: [
              {
                parentToolCallId: 'subagent-file',
                parentToolName: 'file',
                pendingToolIds: ['tool-never-dispatched'],
                checkpointId: 'cp-file',
              },
            ],
          }
          return
        }
        bodies.push(JSON.parse(String(fetchOptions.body)))
        context.streamComplete = true
        context.completionStatus = MothershipStreamV1CompletionStatus.complete
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-missing-subagent-result' },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0].checkpointId).toBe('cp-file')
    expect(bodies[0].results).toEqual([
      expect.objectContaining({
        callId: 'tool-never-dispatched',
        success: false,
        data: { error: expect.stringContaining('no result was returned') },
      }),
    ])
    expect(result.success).toBe(true)
  })

  it('cancels promptly while a per-subagent tool promise remains unsettled', async () => {
    const controller = new AbortController()
    const addAbortListener = vi.spyOn(controller.signal, 'addEventListener')
    const fetchUrls: string[] = []
    let capturedContext: StreamingContext | null = null
    mockRunStreamLoop.mockImplementationOnce(
      async (fetchUrl: string, _fetchOptions: RequestInit, context: StreamingContext) => {
        fetchUrls.push(fetchUrl)
        capturedContext = context
        context.toolCalls.set('tool-hung', {
          id: 'tool-hung',
          name: 'read',
          status: 'executing',
        })
        context.pendingToolPromises.set('tool-hung', new Promise(() => {}))
        context.awaitingAsyncContinuation = {
          checkpointId: 'cp-root',
          pendingToolCallIds: ['tool-hung'],
          frames: [
            {
              parentToolCallId: 'subagent-file',
              parentToolName: 'file',
              pendingToolIds: ['tool-hung'],
              checkpointId: 'cp-file',
            },
          ],
        }
      }
    )

    const lifecycle = runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-aborted-subagent-wait' },
      { userId: 'user-1', workspaceId: 'ws-1', abortSignal: controller.signal }
    )

    await vi.waitFor(() => {
      expect(addAbortListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    })
    controller.abort('user_stop')
    const result = await lifecycle

    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(fetchUrls).toEqual(['http://mothership.test/api/copilot'])
    expect(mockForceFailHungToolCall).not.toHaveBeenCalled()
    expect(capturedContext?.toolCalls.get('tool-hung')).toMatchObject({
      status: MothershipStreamV1ToolOutcome.cancelled,
      error: 'Stopped by user',
    })
  })

  it('classifies a Stop landing during a subagent fanout as cancelled', async () => {
    // Guards the trap in the fanout fix: `wasAborted` is now isolated per leg, so
    // a user Stop must still reach the turn — via the abort signal or the folded
    // turn-level abort — or a cancelled turn would be reported as a success.
    const controller = new AbortController()
    mockRunStreamLoop.mockImplementation(
      async (
        fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        if (!fetchUrl.includes('/api/tools/resume')) {
          context.toolCalls.set('tool-done', {
            id: 'tool-done',
            name: 'read',
            status: MothershipStreamV1ToolOutcome.success,
            result: { success: true },
            endTime: Date.now(),
          })
          context.awaitingAsyncContinuation = {
            checkpointId: 'cp-root',
            pendingToolCallIds: [],
            frames: [
              {
                parentToolCallId: 'subagent-file',
                parentToolName: 'file',
                pendingToolIds: ['tool-done'],
                checkpointId: 'cp-file',
              },
            ],
          }
          return
        }
        // The user hits Stop mid-fanout. `wasAborted` is isolated per leg now, so
        // the turn's own signal is what has to carry the cancellation into the
        // classification — reading only `context.wasAborted` reports success.
        controller.abort('user_stop')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-stop-during-fanout' },
      { userId: 'user-1', workspaceId: 'ws-1', abortSignal: controller.signal }
    )

    expect(result.cancelled).toBe(true)
    expect(result.success).toBe(false)
  })
})
