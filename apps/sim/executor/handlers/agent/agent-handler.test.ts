import {
  dbChainMockFns,
  loggerMock,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { resetDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { AgentTurnSession } from '@/lib/memory/agent-turn-session'
import * as userFileBase64 from '@/lib/uploads/utils/user-file-base64.server'
import { getAllBlocks } from '@/blocks'
import { AGENT, BlockType } from '@/executor/constants'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import * as agentMemory from '@/executor/handlers/agent/memory'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import {
  getEncryptedConversationMessage,
  setEncryptedConversationMessage,
} from '@/providers/conversation-metadata'
import { installStreamingCostPolicy } from '@/providers/cost-policy'
import { getModelCapabilities, SIM_AUTO_MODEL_ID } from '@/providers/models'
import {
  getProviderToolInputProvenance,
  getProviderToolModelInputRegistry,
} from '@/providers/tool-input-provenance'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool } from '@/tools'
import { ToolSchemaEnrichmentError } from '@/tools/params'

process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

const {
  mockDiscoverMcpServerToolsAsExecutor,
  mockImportWorkspaceFileSecretProvenanceForModelView,
  mockValidateModelProvider,
  mockOpenAgentTurnSession,
} = vi.hoisted(() => ({
  mockDiscoverMcpServerToolsAsExecutor: vi.fn().mockResolvedValue([]),
  mockImportWorkspaceFileSecretProvenanceForModelView: vi.fn().mockResolvedValue(true),
  mockValidateModelProvider: vi.fn().mockResolvedValue(undefined),
  mockOpenAgentTurnSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/agent-turn-session', () => ({
  openAgentTurnSession: mockOpenAgentTurnSession,
}))

vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: mockDiscoverMcpServerToolsAsExecutor,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn().mockResolvedValue(undefined),
  validateBlockType: vi.fn().mockResolvedValue(undefined),
  validateModelProvider: mockValidateModelProvider,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  importWorkspaceFileSecretProvenanceForModelView:
    mockImportWorkspaceFileSecretProvenanceForModelView,
}))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getProviderFromModel: vi.fn().mockReturnValue('mock-provider'),
  isDeepResearchModel: (model: string) => model.includes('deep-research'),
  transformBlockTool: vi.fn(),
  getBaseModelProviders: vi.fn().mockReturnValue({ openai: {}, anthropic: {} }),
  getApiKey: vi.fn().mockReturnValue('mock-api-key'),
  getProvider: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          content: 'Mocked response content',
          model: 'mock-model',
          tokens: { input: 10, output: 20, total: 30 },
          toolCalls: [],
          cost: 0.001,
          timing: { total: 100 },
        }),
      },
    },
  }),
}))

vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn().mockReturnValue([]),
  getBlock: vi.fn().mockReturnValue(undefined),
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: vi.fn().mockResolvedValue({
    content: 'Mocked response content',
    model: 'mock-model',
    tokens: { input: 10, output: 20, total: 30 },
    toolCalls: [],
    cost: 0.001,
    timing: { total: 100 },
  }),
}))

vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
  buildAPIUrl: vi.fn((path: string, params?: Record<string, string>) => {
    const url = new URL(path, 'http://localhost:3000')
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value)
        }
      }
    }
    return url
  }),
  extractAPIErrorMessage: vi.fn(async (response: Response) => {
    const defaultMessage = `API request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      return errorData.error || defaultMessage
    } catch {
      return defaultMessage
    }
  }),
}))

/** Connected MCP servers every workspace-server lookup in this suite resolves. */
const MCP_SERVER_ROWS = [
  {
    id: 'mcp-search-server',
    connectionStatus: 'connected',
    credentialGroupId: null,
    enabled: true,
  },
  { id: 'same-server', connectionStatus: 'connected', credentialGroupId: null, enabled: true },
  {
    id: 'mcp-legacy-server',
    connectionStatus: 'connected',
    credentialGroupId: null,
    enabled: true,
  },
]

const mockReadAvailableCustomToolByIdOrTitleAsExecutor = vi.fn()

vi.mock('@/lib/internal/custom-tools/read-available-by-id-or-title', () => ({
  readAvailableCustomToolByIdOrTitleAsExecutor: (...args: unknown[]) =>
    mockReadAvailableCustomToolByIdOrTitleAsExecutor(...args),
}))

const mockGetAllBlocks = getAllBlocks as Mock
const mockExecuteTool = executeTool as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockTransformBlockTool = transformBlockTool as Mock
const mockFetch = vi.fn()
const mockExecuteProviderRequest = executeProviderRequest as Mock
const mockAgentLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'AgentBlockHandler')
].value

beforeAll(() => {
  setEnvFlags({ isDev: true, isTest: false })
})

afterAll(resetEnvFlagsMock)

describe('AgentBlockHandler', () => {
  let handler: AgentBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new AgentBlockHandler()
    vi.clearAllMocks()
    mockOpenAgentTurnSession.mockReset().mockResolvedValue(undefined)
    mockValidateModelProvider.mockReset().mockResolvedValue(undefined)
    mockDiscoverMcpServerToolsAsExecutor.mockImplementation(
      async ({ serverId }: { serverId: string }) =>
        [
          'read_file',
          'search_files',
          'list_files',
          'search',
          'failing_tool',
          'test_tool',
          'tool',
          'tool_1',
          'tool_2',
          'tool_3',
          'tool1',
          'tool2',
        ].map((name) => ({
          name,
          serverId,
          serverName: 'Live server',
          description: `Live ${name}`,
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, path: { type: 'string' } },
          },
        }))
    )
    mockImportWorkspaceFileSecretProvenanceForModelView.mockResolvedValue(true)
    resetDbChainMock()
    // The MCP server lookup awaits select().from(mcpServers).where(...) directly;
    // queue a set per lookup so the structural where spy keeps its default wiring.
    queueTableRows(schemaMock.mcpServers, MCP_SERVER_ROWS)

    // unstubGlobals removes any module-scope fetch stub before each test, so re-stub here
    vi.stubGlobal('fetch', mockFetch)

    Object.defineProperty(global, 'window', {
      value: {},
      writable: true,
      configurable: true,
    })

    mockBlock = {
      id: 'test-agent-block',
      metadata: { id: BlockType.AGENT, name: 'Test Agent' },
      type: BlockType.AGENT,
      position: { x: 0, y: 0 },
      config: {
        tool: 'mock-tool',
        params: {},
      },
      inputs: {},
      outputs: {},
      enabled: true,
    } as SerializedBlock
    mockContext = {
      workspaceId: 'test-workspace',
      workflowId: 'test-workflow',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { startTime: new Date().toISOString(), duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: {
        blocks: [],
        connections: [],
        version: '1.0.0',
        loops: {},
      } as SerializedWorkflow,
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    }
    mockGetProviderFromModel.mockReturnValue('mock-provider')

    mockExecuteProviderRequest.mockResolvedValue({
      content: 'Mocked response content',
      model: 'mock-model',
      tokens: { input: 10, output: 20, total: 30 },
      toolCalls: [],
      cost: 0.001,
      timing: { total: 100 },
    })

    mockFetch.mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        headers: {
          get: () => null,
        },
        json: () => Promise.resolve({}),
      })
    })

    mockTransformBlockTool.mockImplementation((tool: { id?: string; operation?: string }) => ({
      id: `transformed_${tool.id}`,
      name: `${tool.id}_${tool.operation}`,
      description: 'Transformed tool',
      parameters: { type: 'object', properties: {} },
    }))
    mockGetAllBlocks.mockReturnValue([])

    mockExecuteTool.mockImplementation((toolId, params) => {
      if (toolId === 'function_execute') {
        return Promise.resolve({
          success: true,
          output: { result: 'Executed successfully', params },
        })
      }
      return Promise.resolve({ success: false, error: 'Unknown tool' })
    })
  })

  afterEach(() => {
    try {
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
        configurable: true,
      })
    } catch (e) {}
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('native evaluation models', () => {
    const questions = { passed: { type: 'noul', instructions: 'Did the task succeed?' } }
    const inputs: AgentInputs = {
      model: 'jev-1.13.0',
      apiKey: 'test-key',
      evaluationState: 'Task complete',
      evaluationQuestions: questions,
    }

    it('ignores saved chat settings after switching the model to Jev', async () => {
      mockGetProviderFromModel.mockReturnValue('typesafe')
      await handler.execute(mockContext, mockBlock, {
        ...inputs,
        messages: [{ role: 'user', content: 'Old conversation' }],
        systemPrompt: 'Old prompt',
        tools: [{ type: 'custom-tool', title: 'Stale tool' }],
        skills: [{ skillId: 'stale-skill' }],
        responseFormat: '{invalid stale JSON',
        memoryType: 'conversation',
        conversationId: 'stale-conversation',
        temperature: 0.5,
        maxTokens: 100,
        files: [{ name: 'old.png' }],
        fallbackModels: [{ model: 'gpt-4o' }],
      })
      const request = mockExecuteProviderRequest.mock.calls[0][1]
      expect(request).toMatchObject({
        evaluation: { state: 'Task complete', questions },
        tools: [],
        context: undefined,
        temperature: undefined,
        maxTokens: undefined,
      })
      expect(request.messages ?? []).toEqual([])
      expect(mockOpenAgentTurnSession).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).toHaveBeenCalledOnce()
    })

    it.each(['evaluationState', 'evaluationQuestions'] as const)(
      'projects secrets in %s before the provider boundary',
      async (field) => {
        const registry = new ResolvedSecretTraceRegistry([
          { name: 'PRIVATE_TEXT', plaintext: 'private value', encryptedValue: 'encrypted' },
        ])
        const path = field === 'evaluationState' ? [field] : [field, 'passed', 'instructions']
        registry.recordResolvedAtInputPath('PRIVATE_TEXT', 'private value', path)
        registry.recordResolvedInputProjection(path, 'private value', '{{PRIVATE_TEXT}}')
        mockContext.resolvedSecretTraceRegistry = registry
        mockGetProviderFromModel.mockReturnValue('typesafe')
        await handler.execute(mockContext, mockBlock, {
          ...inputs,
          [field]:
            field === 'evaluationState'
              ? 'private value'
              : { passed: { type: 'noul', instructions: 'private value' } },
        })
        const request = mockExecuteProviderRequest.mock.calls[0][1]
        expect(JSON.stringify(request.evaluation)).not.toContain('private value')
        expect(JSON.stringify(request.evaluation)).toContain('{{PRIVATE_TEXT}}')
        expect(request.apiKey).toBe('test-key')
      }
    )

    it('refuses an evaluation model as a conversational fallback before executing the primary', async () => {
      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
          fallbackModels: [{ model: 'jev-latest' }],
        })
      ).rejects.toThrow('Evaluation models cannot serve as chat fallbacks')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })
  })

  describe('durable conversation lifecycle', () => {
    const inputs: AgentInputs = {
      model: 'gpt-4o',
      memoryType: 'conversation',
      conversationId: 'conversation-1',
      messages: [{ role: 'user', content: 'Continue the work.' }],
      userPrompt: 'Keep the answer brief.',
    }

    afterEach(() => vi.restoreAllMocks())

    it('shares one turn across fallback and preserves private history metadata', async () => {
      const session = {
        turnId: 'turn-1',
        memoryId: 'memory-1',
        finalize: vi.fn(),
        getFinalResponse: vi.fn(),
        getFinalAssistantContent: vi.fn(),
      }
      mockOpenAgentTurnSession.mockResolvedValue(session)
      mockGetProviderFromModel.mockImplementation((model: string) =>
        model.startsWith('claude') ? 'anthropic' : 'openai'
      )
      const assistant: Message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      }
      setEncryptedConversationMessage(assistant, 'encrypted-private-native-history')
      const fetch = vi
        .spyOn(agentMemory.memoryService, 'fetchMemoryMessages')
        .mockResolvedValue([
          { role: 'user', content: 'Search first.' },
          assistant,
          { role: 'tool', content: '{"answer":42}', name: 'search', tool_call_id: 'call-1' },
        ])
      const append = vi.spyOn(agentMemory.memoryService, 'appendToMemory').mockResolvedValue()
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('overloaded'))

      await handler.execute(
        { ...mockContext, executionId: 'execution-1' },
        mockBlock,
        { ...inputs, fallbackModels: [{ model: 'claude-sonnet-5' }] },
        { nodeId: 'agent-node', executionOrder: 3 }
      )

      expect(mockOpenAgentTurnSession).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'agent-node', executionOrder: 3 })
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(WeakMap),
        { richHistory: true, excludeTurnId: 'turn-1', memoryId: 'memory-1' }
      )
      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      for (const [, request, runtime] of mockExecuteProviderRequest.mock.calls) {
        expect(runtime.agentConversation).toBe(session)
        expect(request.messages[1]).toEqual(assistant)
        expect(getEncryptedConversationMessage(request.messages[1])).toBe(
          'encrypted-private-native-history'
        )
      }
      expect(append.mock.calls.map((call) => call[3]?.appendKey)).toEqual(['input', 'user-prompt'])
      for (const call of append.mock.calls) {
        expect(call[3]).toMatchObject({ memoryId: 'memory-1', turnId: 'turn-1' })
      }
      expect(session.finalize).toHaveBeenCalledWith('Mocked response content', 'claude-sonnet-5')
    })

    it('deduplicates retry inputs by invocation while another loop iteration gets a new turn', async () => {
      const stored: Message[] = []
      const turns = new WeakMap<object, string>()
      const keys = new WeakMap<object, string>()
      vi.spyOn(agentMemory, 'getMemoryMessageTurnId').mockImplementation((message) =>
        turns.get(message)
      )
      vi.spyOn(agentMemory, 'getMemoryMessageAppendKey').mockImplementation((message) =>
        keys.get(message)
      )
      vi.spyOn(agentMemory.memoryService, 'fetchMemoryMessages').mockImplementation(async () => [
        ...stored,
      ])
      const append = vi
        .spyOn(agentMemory.memoryService, 'appendToMemory')
        .mockImplementation(async (_ctx, _inputs, message, options) => {
          stored.push(message)
          if (options) {
            turns.set(message, options.turnId)
            keys.set(message, options.appendKey)
          }
        })
      const first = {
        turnId: 'turn-1',
        memoryId: 'memory-1',
        finalize: vi.fn(),
        getFinalResponse: vi.fn(),
        getFinalAssistantContent: vi.fn(),
      }
      const second = {
        turnId: 'turn-2',
        memoryId: 'memory-1',
        finalize: vi.fn(),
        getFinalResponse: vi.fn(),
        getFinalAssistantContent: vi.fn(),
      }
      mockOpenAgentTurnSession
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second)
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('retry this block'))
      const ctx = { ...mockContext, executionId: 'execution-1' }

      await expect(
        handler.execute(ctx, mockBlock, inputs, { nodeId: 'agent-node', executionOrder: 3 })
      ).rejects.toThrow('retry this block')
      await handler.execute(ctx, mockBlock, inputs, { nodeId: 'agent-node', executionOrder: 3 })
      await handler.execute(ctx, mockBlock, inputs, { nodeId: 'agent-node', executionOrder: 4 })

      expect(append.mock.calls.map((call) => [call[3]?.turnId, call[3]?.appendKey])).toEqual([
        ['turn-1', 'seed:0'],
        ['turn-1', 'user-prompt'],
        ['turn-2', 'input'],
        ['turn-2', 'user-prompt'],
      ])
      expect(mockExecuteProviderRequest.mock.calls[1][1].messages).toHaveLength(2)
      expect(mockExecuteProviderRequest.mock.calls[2][1].messages).toHaveLength(4)
    })

    it('persists the complete captured answer when structured output removes its content field', async () => {
      const content = '{"answer":42}'
      const session = {
        turnId: 'turn-1',
        memoryId: 'memory-1',
        finalize: vi.fn(),
        getFinalResponse: vi.fn(),
        getFinalAssistantContent: () => content,
      }
      mockOpenAgentTurnSession.mockResolvedValue(session)
      vi.spyOn(agentMemory.memoryService, 'fetchMemoryMessages').mockResolvedValue([])
      const append = vi.spyOn(agentMemory.memoryService, 'appendToMemory').mockResolvedValue()
      mockExecuteProviderRequest.mockResolvedValueOnce({ content, model: 'gpt-4o' })
      const result = await handler.execute(
        { ...mockContext, executionId: 'execution-1' },
        mockBlock,
        {
          ...inputs,
          responseFormat: { type: 'object', properties: { answer: { type: 'number' } } },
        },
        { nodeId: 'agent-node', executionOrder: 3 }
      )
      expect(result).toMatchObject({ answer: 42 })
      expect(result).not.toHaveProperty('content')
      expect(append.mock.calls.every((call) => call[2].role === 'user')).toBe(true)
      expect(session.finalize).toHaveBeenCalledWith(content, 'gpt-4o')
    })

    it('finalizes a tool-only answer without creating an empty public assistant message', async () => {
      const session = {
        turnId: 'turn-1',
        memoryId: 'memory-1',
        finalize: vi.fn(),
        getFinalResponse: vi.fn(),
        getFinalAssistantContent: vi.fn(),
      }
      mockOpenAgentTurnSession.mockResolvedValue(session)
      vi.spyOn(agentMemory.memoryService, 'fetchMemoryMessages').mockResolvedValue([])
      const append = vi.spyOn(agentMemory.memoryService, 'appendToMemory').mockResolvedValue()
      mockExecuteProviderRequest.mockResolvedValueOnce({ content: '', model: 'gpt-4o' })
      await handler.execute({ ...mockContext, executionId: 'execution-1' }, mockBlock, inputs, {
        nodeId: 'agent-node',
        executionOrder: 3,
      })
      expect(append.mock.calls.every((call) => call[2].role === 'user')).toBe(true)
      expect(session.finalize).toHaveBeenCalledWith('', 'gpt-4o')
    })
  })

  describe('conversation attachment replay', () => {
    beforeEach(() => {
      dbChainMockFns.returning.mockResolvedValue([{ id: 'memory-1' }])
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    const file = {
      id: 'file-1',
      name: 'example.png',
      key: 'execution/test-workspace/test-workflow/exec-1/example.png',
      url: 'https://storage.example.com/expired',
      size: 8,
      type: 'image/png',
      context: 'execution',
      base64: 'iVBORw0KGgo=',
    }

    it.each(['files', 'messages', 'userPrompt'] as const)(
      'replays a previous turn from %s with a fresh provider attachment',
      async (source) => {
        mockGetProviderFromModel.mockReturnValue('openai')
        const hydrate = vi
          .spyOn(userFileBase64, 'hydrateUserFilesWithBase64')
          .mockImplementation(async (value) => {
            const files = value as (typeof file)[]
            return files.map((attachment) => ({
              ...attachment,
              base64: file.base64,
            })) as typeof value
          })
        const inputs: AgentInputs = {
          model: 'gpt-4o',
          memoryType: 'conversation',
          conversationId: 'conversation-1',
          ...(source === 'userPrompt'
            ? { userPrompt: 'Analyze this file', files: [file] }
            : {
                messages: [
                  {
                    role: 'user',
                    content: 'Analyze this file',
                    ...(source === 'messages' ? { files: [file] } : {}),
                  },
                ],
                ...(source === 'files' ? { files: [file] } : {}),
              }),
        }
        const original = structuredClone(inputs)
        await handler.execute({ ...mockContext, executionId: 'exec-1' }, mockBlock, inputs)
        const stored = dbChainMockFns.values.mock.calls
          .map(([row]) => row)
          .find((row) => Array.isArray(row.data) && row.data[0]?.role === 'user')?.data as Message[]
        expect(stored).toBeDefined()
        expect(stored[0].files).toEqual([
          {
            id: file.id,
            name: file.name,
            key: file.key,
            url: '',
            size: file.size,
            type: file.type,
            context: file.context,
          },
        ])
        expect(inputs).toEqual(original)

        queueTableRows(schemaMock.memory, [
          {
            secretProvenanceVersion: null,
            data: [...stored, { role: 'assistant', content: 'First answer' }],
          },
        ])
        mockGetProviderFromModel.mockReturnValue('anthropic')
        const nextContext = { ...mockContext, executionId: 'exec-2' }
        await handler.execute(nextContext, mockBlock, {
          model: 'claude-sonnet-4-5',
          memoryType: 'conversation',
          conversationId: 'conversation-1',
          messages: [{ role: 'user', content: 'What is in that file?' }],
        })
        const request = mockExecuteProviderRequest.mock.calls.at(-1)?.[1]
        expect(request.messages[0]).toMatchObject({
          role: 'user',
          content: 'Analyze this file',
          files: [{ key: file.key, base64: file.base64 }],
        })
        expect(request.messages.at(-1)).toMatchObject({
          role: 'user',
          content: 'What is in that file?',
        })
        expect(request.messages.at(-1).files).toBeUndefined()
        expect(hydrate.mock.calls.at(-1)?.[0]).toEqual(stored[0].files)
        expect(hydrate.mock.calls.at(-1)?.[1]).toMatchObject({
          executionId: 'exec-2',
          fileKeys: [file.key],
        })
        hydrate.mockRestore()
      }
    )

    it('does not duplicate an attachment when the same execution revisits the agent', async () => {
      mockGetProviderFromModel.mockReturnValue('openai')
      queueTableRows(schemaMock.memory, [
        {
          secretProvenanceVersion: null,
          data: [
            { role: 'user', content: 'Analyze this file', executionId: 'exec-1', files: [file] },
          ],
        },
      ])
      await handler.execute({ ...mockContext, executionId: 'exec-1' }, mockBlock, {
        model: 'gpt-4o',
        memoryType: 'conversation',
        conversationId: 'conversation-1',
        messages: [{ role: 'user', content: 'Analyze this file' }],
        files: [file],
      })
      expect(mockExecuteProviderRequest.mock.calls[0][1].messages[0].files).toHaveLength(1)
      expect(dbChainMockFns.values.mock.calls.some(([row]) => row.data?.[0]?.role === 'user')).toBe(
        false
      )
    })
  })

  describe('model fallback', () => {
    const baseInputs = {
      model: 'gpt-4o',
      userPrompt: 'Hello',
      apiKey: 'primary-key',
      temperature: 0.4,
    }

    const providerFor = (model: string) => {
      if (model.startsWith('gpt')) return 'openai'
      if (model.startsWith('claude')) return 'anthropic'
      if (model === 'blacklisted-model') throw new Error('provider blacklisted')
      return 'openai'
    }

    const providerResponse = (model: string, content = 'ok') => ({
      content,
      model,
      tokens: { input: 1, output: 1, total: 2 },
      toolCalls: [],
      cost: 0,
      timing: { total: 1 },
    })

    const openLog = (blockId = mockBlock.id, endedAt = '') => ({
      blockId,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt,
      durationMs: 0,
      success: false,
      executionOrder: 1,
    })

    const streamingResponse = (
      chunks: string[],
      options: { failBeforeFirstChunk?: Error; failAfterFirstChunk?: Error } = {}
    ) => ({
      stream: new ReadableStream<string>({
        async pull(controller) {
          if (options.failBeforeFirstChunk) throw options.failBeforeFirstChunk
          const chunk = chunks.shift()
          if (chunk !== undefined) {
            controller.enqueue(chunk)
            return
          }
          if (options.failAfterFirstChunk) throw options.failAfterFirstChunk
          controller.close()
        },
      }),
      execution: { output: { content: '' } },
    })

    const drain = async (stream: ReadableStream<string>) => {
      const reader = stream.getReader()
      const chunks: string[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return chunks
        chunks.push(value)
      }
    }

    beforeEach(() => {
      setEnvFlags({ isHosted: false })
      resetDeploymentShape()
      mockGetProviderFromModel.mockImplementation(providerFor)
      mockValidateModelProvider.mockResolvedValue(undefined)
    })

    it('falls through to the next model with the same request and no primary-only fields', async () => {
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('overloaded'))
        .mockResolvedValueOnce(providerResponse('claude-sonnet-5', 'from fallback'))
      const blockLog = openLog()
      const ctx = { ...mockContext, blockLogs: [blockLog] }

      const result = await handler.execute(ctx, mockBlock, {
        ...baseInputs,
        fallbackModels: [{ id: 'row-1', model: 'claude-sonnet-5' }],
      })

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      const [primaryProvider, primaryRequest] = mockExecuteProviderRequest.mock.calls[0]
      const [fallbackProvider, fallbackRequest] = mockExecuteProviderRequest.mock.calls[1]
      expect(primaryProvider).toBe('openai')
      expect(fallbackProvider).toBe('anthropic')
      expect(fallbackRequest.model).toBe('claude-sonnet-5')
      expect(fallbackRequest.messages).toEqual(primaryRequest.messages)
      expect(fallbackRequest.temperature).toBe(primaryRequest.temperature)
      expect((result as { model: string }).model).toBe('claude-sonnet-5')
      expect(mockAgentLogger.warn).toHaveBeenCalledWith(
        'Agent model failed; trying fallback',
        expect.objectContaining({ failedModel: 'gpt-4o', nextModel: 'claude-sonnet-5' })
      )
      expect(blockLog).toMatchObject({ modelFallbacks: ['gpt-4o'] })
    })

    it.each([
      { memoryType: 'conversation', streaming: false },
      { memoryType: 'conversation', streaming: true },
      { memoryType: 'sliding_window', streaming: false },
      { memoryType: 'sliding_window', streaming: true },
    ] as const)(
      'preserves $memoryType history through fallback and saves each turn once (streaming=$streaming)',
      async ({ memoryType, streaming }) => {
        dbChainMockFns.returning.mockResolvedValue([{ id: 'memory-1' }])
        const history: Message[] = [
          { role: 'user', content: 'Hello.' },
          { role: 'assistant', content: 'How can I help?' },
          { role: 'user', content: 'My name is Ada.' },
          { role: 'assistant', content: 'Hello Ada.' },
        ]
        queueTableRows(schemaMock.memory, [{ secretProvenanceVersion: null, data: history }])
        const ctx = { ...mockContext, executionId: 'memory-fallback-execution' }
        const inputs: AgentInputs = {
          ...baseInputs,
          userPrompt: undefined,
          memoryType,
          slidingWindowSize: '2',
          conversationId: 'conversation-1',
          messages: [
            { role: 'system', content: 'Use the conversation history.' },
            { role: 'user', content: 'What is my name?' },
          ],
          fallbackModels: [{ model: 'claude-sonnet-5' }],
        }
        const original = structuredClone(inputs)
        if (streaming) {
          mockExecuteProviderRequest
            .mockResolvedValueOnce(
              streamingResponse([], { failBeforeFirstChunk: new Error('overloaded') })
            )
            .mockResolvedValueOnce(streamingResponse(['Your name is Ada.']))
        } else {
          mockExecuteProviderRequest
            .mockRejectedValueOnce(new Error('overloaded'))
            .mockResolvedValueOnce(providerResponse('claude-sonnet-5', 'Your name is Ada.'))
        }

        const result = await handler.execute(ctx, mockBlock, inputs)

        expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
        const currentUserMessage = {
          role: 'user',
          content: 'What is my name?',
          executionId: ctx.executionId,
        }
        const expectedMessages = [
          { role: 'system', content: 'Use the conversation history.' },
          ...(memoryType === 'sliding_window' ? history.slice(-2) : history),
          { role: 'user', content: 'What is my name?' },
        ]
        for (const [, request] of mockExecuteProviderRequest.mock.calls) {
          expect(request.messages).toEqual(expectedMessages)
        }
        expect(mockExecuteProviderRequest.mock.calls[1][0]).toBe('anthropic')
        if (streaming) {
          const streamedResult = result as StreamingExecution
          expect(await drain(streamedResult.stream)).toEqual(['Your name is Ada.'])
          expect(streamedResult.onFullContent).toBeTypeOf('function')
          await streamedResult.onFullContent?.('Your name is Ada.')
        }

        const memoryWrites = dbChainMockFns.values.mock.calls
          .map(([row]) => row)
          .filter((row) => Array.isArray(row.data))
        expect(memoryWrites.map((row) => row.data)).toEqual([
          [currentUserMessage],
          [{ role: 'assistant', content: 'Your name is Ada.' }],
        ])
        expect(memoryWrites.every((row) => row.key === inputs.conversationId)).toBe(true)
        expect(inputs).toEqual(original)
      }
    )

    it('holds the fallbacks on a try the executor will replay', async () => {
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('overloaded'))
      const blockLog = openLog()
      blockLog.modelFallbacks = ['stale-from-earlier-run']

      await expect(
        handler.execute(
          { ...mockContext, blockLogs: [blockLog] },
          mockBlock,
          { ...baseInputs, fallbackModels: [{ model: 'claude-sonnet-5' }] },
          { nodeId: mockBlock.id, retry: { attempt: 1, maxTries: 3, isFinalTry: false } }
        )
      ).rejects.toThrow('overloaded')

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
      expect(mockAgentLogger.info).toHaveBeenCalledWith('Fallback models held for the final try', {
        blockId: mockBlock.id,
        attempt: 1,
        maxTries: 3,
      })
      expect(mockAgentLogger.warn).not.toHaveBeenCalledWith(
        'Agent model failed; trying fallback',
        expect.anything()
      )
      expect(blockLog.modelFallbacks).toBeUndefined()
    })

    it('walks the chain on the final try, and on a block that never retries', async () => {
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('overloaded'))
        .mockResolvedValueOnce(providerResponse('claude-sonnet-5'))
        .mockRejectedValueOnce(new Error('overloaded'))
        .mockResolvedValueOnce(providerResponse('claude-sonnet-5'))
      const inputs = { ...baseInputs, fallbackModels: [{ model: 'claude-sonnet-5' }] }

      const onFinalTry = await handler.execute(mockContext, mockBlock, inputs, {
        nodeId: mockBlock.id,
        retry: { attempt: 3, maxTries: 3, isFinalTry: true },
      })
      const withoutPolicy = await handler.execute(mockContext, mockBlock, inputs, {
        nodeId: mockBlock.id,
      })

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(4)
      expect((onFinalTry as { model: string }).model).toBe('claude-sonnet-5')
      expect((withoutPolicy as { model: string }).model).toBe('claude-sonnet-5')
      expect(mockAgentLogger.info).not.toHaveBeenCalledWith(
        'Fallback models held for the final try',
        expect.anything()
      )
    })

    it('never falls back on a deep-research follow-up turn', async () => {
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('overloaded'))

      await expect(
        handler.execute(mockContext, mockBlock, {
          ...baseInputs,
          previousInteractionId: 'interaction-1',
          fallbackModels: [{ model: 'claude-sonnet-5' }],
        })
      ).rejects.toThrow('overloaded')
      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
      expect(mockAgentLogger.info).toHaveBeenCalledWith(
        'Fallback models skipped for a deep-research follow-up turn',
        expect.objectContaining({ blockId: mockBlock.id })
      )
    })

    it('gives a fallback its own key, the block key on the same provider, and nothing otherwise', async () => {
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('one'))
        .mockRejectedValueOnce(new Error('two'))
        .mockRejectedValueOnce(new Error('three'))
        .mockResolvedValueOnce(providerResponse('gpt-4o-mini'))

      const storedRows = [
        { model: 'claude-sonnet-5', apiKey: '{{ANTHROPIC_KEY}}' },
        { model: 'claude-haiku-5' },
        { model: 'gpt-4o-mini' },
      ]
      const block = {
        ...mockBlock,
        config: { ...mockBlock.config, params: { fallbackModels: storedRows } },
      }
      await handler.execute(mockContext, block, {
        ...baseInputs,
        fallbackModels: [
          { model: 'claude-sonnet-5', apiKey: 'anthropic-row-key' },
          { model: 'claude-haiku-5' },
          { model: 'gpt-4o-mini' },
        ],
      })

      const keys = mockExecuteProviderRequest.mock.calls.map(([, request]) => request.apiKey)
      expect(keys).toEqual(['primary-key', 'anthropic-row-key', undefined, 'primary-key'])
    })

    it.each([
      { hosted: false, primary: 'gpt-4o', fallback: 'gpt-4o-mini', expectedKey: 'primary-key' },
      { hosted: true, primary: 'gpt-4o', fallback: 'claude-sonnet-5', expectedKey: undefined },
    ])(
      'ignores a hidden row key for $fallback with hosted=$hosted',
      async ({ hosted, primary, fallback, expectedKey }) => {
        setEnvFlags({ isHosted: hosted })
        resetDeploymentShape()
        mockExecuteProviderRequest
          .mockRejectedValueOnce(new Error('overloaded'))
          .mockResolvedValueOnce(providerResponse(fallback))
        const block = {
          ...mockBlock,
          config: {
            ...mockBlock.config,
            params: { fallbackModels: [{ model: fallback, apiKey: '{{OLD_KEY}}' }] },
          },
        }

        await handler.execute(mockContext, block, {
          ...baseInputs,
          model: primary,
          fallbackModels: [{ model: fallback, apiKey: 'old-row-key' }],
        })

        expect(mockExecuteProviderRequest.mock.calls[1][1].apiKey).toBe(expectedKey)
      }
    )

    it('leaves provider-family credentials off a fallback on another provider', async () => {
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('one'))
        .mockRejectedValueOnce(new Error('two'))
        .mockResolvedValueOnce(providerResponse('gpt-4o-mini'))

      await handler.execute(mockContext, mockBlock, {
        ...baseInputs,
        vertexCredential: 'vertex-secret',
        bedrockSecretKey: 'bedrock-secret',
        azureEndpoint: 'https://azure.example.com',
        fallbackModels: [{ model: 'claude-sonnet-5' }, { model: 'gpt-4o-mini' }],
      })

      const [, crossProvider] = mockExecuteProviderRequest.mock.calls[1]
      const [, sameProvider] = mockExecuteProviderRequest.mock.calls[2]
      expect(crossProvider.vertexCredential).toBeUndefined()
      expect(crossProvider.bedrockSecretKey).toBeUndefined()
      expect(crossProvider.azureEndpoint).toBeUndefined()
      expect(JSON.stringify(crossProvider)).not.toMatch(
        /vertex-secret|bedrock-secret|azure\.example/
      )
      expect(sameProvider.bedrockSecretKey).toBe('bedrock-secret')
      expect(sameProvider.azureEndpoint).toBe('https://azure.example.com')
    })

    it('re-resolves tuning for the fallback: row value wins, caps clamp, undeclared values drop', async () => {
      const fallbackCap = getModelCapabilities('gpt-5.4-mini')?.maxOutputTokens
      expect(fallbackCap).toEqual(expect.any(Number))
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(providerResponse('gpt-5.4-mini'))

      await handler.execute(mockContext, mockBlock, {
        ...baseInputs,
        model: 'claude-sonnet-5',
        thinkingLevel: 'high',
        temperature: 0.9,
        maxTokens: (fallbackCap as number) + 5000,
        fallbackModels: [{ model: 'gpt-5.4-mini', reasoningEffort: 'low' }],
      })

      const [, primaryRequest] = mockExecuteProviderRequest.mock.calls[0]
      const [, fallbackRequest] = mockExecuteProviderRequest.mock.calls[1]
      expect(primaryRequest.thinkingLevel).toBe('high')
      expect(primaryRequest.maxTokens).toBe((fallbackCap as number) + 5000)
      expect(fallbackRequest.reasoningEffort).toBe('low')
      expect(fallbackRequest.thinkingLevel).toBeUndefined()
      expect(fallbackRequest.temperature).toBe(0.9)
      expect(fallbackRequest.maxTokens).toBe(fallbackCap)
      expect(mockAgentLogger.info).toHaveBeenCalledWith(
        'Fallback model tuning adjusted',
        expect.objectContaining({ model: 'gpt-5.4-mini' })
      )
    })

    it('rethrows the last attempted model error unchanged when every model fails', async () => {
      const first = new Error('primary down')
      const last = new Error('fallback down')
      mockExecuteProviderRequest.mockRejectedValueOnce(first).mockRejectedValueOnce(last)
      const blockLog = openLog()

      await expect(
        handler.execute({ ...mockContext, blockLogs: [blockLog] }, mockBlock, {
          ...baseInputs,
          fallbackModels: [{ model: 'claude-sonnet-5' }],
        })
      ).rejects.toBe(last)
      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      expect(blockLog).toMatchObject({ modelFallbacks: ['gpt-4o'] })
    })

    it('skips sim-auto, duplicates, the primary itself, and unusable providers', async () => {
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(providerResponse('claude-sonnet-5'))

      await handler.execute(mockContext, mockBlock, {
        ...baseInputs,
        fallbackModels: [
          { model: 'sim-auto' },
          { model: 'GPT-4o' },
          { model: 'blacklisted-model' },
          { model: 'claude-sonnet-5' },
          { model: 'claude-sonnet-5' },
        ],
      })

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      expect(mockExecuteProviderRequest.mock.calls[1][1].model).toBe('claude-sonnet-5')
      expect(mockAgentLogger.warn).toHaveBeenCalledWith(
        'Fallback model unusable; skipping',
        expect.objectContaining({ model: 'blacklisted-model' })
      )
    })

    it('skips a fallback the workspace does not permit', async () => {
      mockValidateModelProvider.mockImplementation(async (_user, _workspace, model: string) => {
        if (model === 'claude-sonnet-5') throw new Error('Model not permitted')
      })
      mockExecuteProviderRequest
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(providerResponse('gpt-4o-mini'))

      await handler.execute(
        { ...mockContext, userId: 'user-1', workspaceId: 'workspace-1' },
        mockBlock,
        {
          ...baseInputs,
          fallbackModels: [{ model: 'claude-sonnet-5' }, { model: 'gpt-4o-mini' }],
        }
      )

      expect(mockExecuteProviderRequest.mock.calls.map(([, request]) => request.model)).toEqual([
        'gpt-4o',
        'gpt-4o-mini',
      ])
      expect(mockAgentLogger.warn).toHaveBeenCalledWith(
        'Fallback model unusable; skipping',
        expect.objectContaining({ model: 'claude-sonnet-5', error: 'Model not permitted' })
      )
    })

    it('does not fall back after a stop', async () => {
      const controller = new AbortController()
      mockExecuteProviderRequest.mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('Provider request timed out')
      })

      await expect(
        handler.execute({ ...mockContext, abortSignal: controller.signal }, mockBlock, {
          ...baseInputs,
          fallbackModels: [{ model: 'claude-sonnet-5' }],
        })
      ).rejects.toThrow('timed out')
      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
    })

    it('does not fall back on an explicitly non-retryable failure, on any try', async () => {
      const error = Object.assign(new Error('permanent'), { retryable: false })
      mockExecuteProviderRequest.mockRejectedValue(error)
      const inputs = { ...baseInputs, fallbackModels: [{ model: 'claude-sonnet-5' }] }

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toBe(error)
      await expect(
        handler.execute(mockContext, mockBlock, inputs, {
          nodeId: mockBlock.id,
          retry: { attempt: 1, maxTries: 3, isFinalTry: false },
        })
      ).rejects.toBe(error)
      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      expect(mockAgentLogger.warn).not.toHaveBeenCalledWith(
        'Agent model failed; trying fallback',
        expect.anything()
      )
    })

    it('falls back when a streaming candidate closes before its first chunk', async () => {
      mockExecuteProviderRequest
        .mockResolvedValueOnce(streamingResponse([]))
        .mockResolvedValueOnce(streamingResponse(['answer']))

      const result = (await handler.execute(mockContext, mockBlock, {
        ...baseInputs,
        fallbackModels: [{ model: 'claude-sonnet-5' }],
      })) as StreamingExecution

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
      expect(mockAgentLogger.warn).toHaveBeenCalledWith(
        'Agent model failed; trying fallback',
        expect.objectContaining({ error: 'Provider stream closed before its first chunk' })
      )
      await expect(drain(result.stream as ReadableStream<string>)).resolves.toEqual(['answer'])
    })

    it('leaves a failure after the first chunk to the stream, as before', async () => {
      const midStream = new Error('dropped mid-stream')
      mockExecuteProviderRequest.mockResolvedValueOnce(
        streamingResponse(['first'], { failAfterFirstChunk: midStream })
      )

      const result = (await handler.execute(mockContext, mockBlock, {
        ...baseInputs,
        fallbackModels: [{ model: 'claude-sonnet-5' }],
      })) as StreamingExecution

      expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
      await expect(drain(result.stream as ReadableStream<string>)).rejects.toBe(midStream)
    })
  })

  describe('execute', () => {
    it('fails fast when a configured tool schema cannot be enriched', async () => {
      const error = new ToolSchemaEnrichmentError(
        'table_query_rows',
        new Error('table metadata unavailable')
      )
      mockTransformBlockTool.mockRejectedValueOnce(error)

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Query the table',
          apiKey: 'test-api-key',
          tools: [{ type: 'table', operation: 'query_rows', usageControl: 'auto' }],
        })
      ).rejects.toBe(error)
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('reports a sim-auto run under the sim-auto identity, not the model that served it', async () => {
      mockExecuteProviderRequest.mockResolvedValue({
        content: 'Mocked response content',
        model: AGENT.DEFAULT_MODEL,
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: [],
        cost: { input: 0.001, output: 0.002, total: 0.003 },
        timing: {
          total: 100,
          timeSegments: [
            { type: 'model', name: AGENT.DEFAULT_MODEL, provider: 'anthropic', duration: 100 },
          ],
        },
      })

      const result = (await handler.execute(mockContext, mockBlock, {
        model: SIM_AUTO_MODEL_ID,
        userPrompt: 'Hello!',
      })) as {
        model: string
        cost: unknown
        tokens: unknown
        providerTiming: { timeSegments: Array<{ name?: string; provider?: string }> }
      }

      expect(result.model).toBe(SIM_AUTO_MODEL_ID)
      expect(result.providerTiming.timeSegments[0].name).toBe(SIM_AUTO_MODEL_ID)
      expect(result.providerTiming.timeSegments[0].provider).toBeUndefined()
      // Only the label changes: tokens and the already-priced cost are untouched.
      expect(result.tokens).toEqual({ input: 10, output: 20, total: 30 })
      expect(result.cost).toEqual({ input: 0.001, output: 0.002, total: 0.003 })
    })

    /** Reaches the private signal builder; routing depends on nothing else. */
    const buildAutoRoutingSignalsFor = (inputs: Record<string, unknown>) =>
      (
        handler as unknown as {
          buildAutoRoutingSignals: (i: unknown, rf: unknown) => { mediaKind: string }
        }
      ).buildAutoRoutingSignals(inputs, undefined)

    const png = { id: 'f1', type: 'image/png' }
    const pdf = { id: 'f2', type: 'application/pdf' }

    it('detects media carried on inbound messages, not just the files input', async () => {
      const signals = buildAutoRoutingSignalsFor({
        messages: [{ role: 'user' as const, content: 'What is in this image?', files: [png] }],
      })

      expect(signals.mediaKind).toBe('image')
    })

    it('overlays the routing charge on a streaming cost written after the fact', async () => {
      // Mirrors the real streaming shape: the policy accessor is installed at
      // provider-return time, the drain writes the final cost long after the
      // handler returned, and consumers read it at log time.
      const output: Record<string, unknown> = { cost: { input: 0, output: 0, total: 0 } }
      installStreamingCostPolicy(output as never, { billable: true, multiplier: 1 })
      const streaming = { stream: new ReadableStream(), execution: { output } }

      ;(
        handler as unknown as { applyRoutingCost: (r: unknown, c: number) => void }
      ).applyRoutingCost(streaming, 0.002)

      // The drain settles the model cost afterwards.
      ;(output as { cost: unknown }).cost = { input: 0.01, output: 0.02, total: 0.03 }

      expect(output.cost).toEqual({
        input: 0.01,
        output: 0.02,
        total: expect.closeTo(0.032, 10),
        routing: 0.002,
      })
    })

    it('adds the routing charge to a settled non-streaming cost', async () => {
      const result: Record<string, unknown> = { cost: { input: 0.01, output: 0.02, total: 0.03 } }

      ;(
        handler as unknown as { applyRoutingCost: (r: unknown, c: number) => void }
      ).applyRoutingCost(result, 0.002)

      expect(result.cost).toEqual({
        input: 0.01,
        output: 0.02,
        total: expect.closeTo(0.032, 10),
        routing: 0.002,
      })
    })

    it('should attach files to the last user message only', async () => {
      const inputs = {
        model: 'gpt-4o',
        messages: [
          { role: 'system' as const, content: 'You are helpful.' },
          { role: 'user' as const, content: 'Earlier question' },
          { role: 'assistant' as const, content: 'Earlier answer' },
          { role: 'user' as const, content: 'Analyze this file' },
        ],
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
            size: 128,
            type: 'image/png',
            base64: 'aW1hZ2U=',
          },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const requestBody = mockExecuteProviderRequest.mock.calls[0][1]
      expect(requestBody.messages[1]).toMatchObject({
        role: 'user',
        content: 'Earlier question',
      })
      expect(requestBody.messages[1].files).toBeUndefined()
      expect(requestBody.messages[3]).toMatchObject({
        role: 'user',
        content: 'Analyze this file',
        files: [
          {
            id: 'file-1',
            name: 'example.png',
            type: 'image/png',
            base64: 'aW1hZ2U=',
          },
        ],
      })
    })

    it('projects a resolver-recorded document name only after raw file hydration', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FILE_NAME', plaintext: 'classified.txt', encryptedValue: 'encrypted-name' },
      ])
      registry.recordResolvedAtInputPath('FILE_NAME', 'classified.txt', ['files', '0', 'name'])
      registry.recordResolvedInputProjection(
        ['files', '0', 'name'],
        'classified.txt',
        '{{FILE_NAME}}'
      )
      mockContext.resolvedSecretTraceRegistry = registry
      mockGetProviderFromModel.mockReturnValue('openai')

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Analyze this file',
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/classified.txt',
            name: 'classified.txt',
            size: 5,
            type: 'text/plain',
            base64: 'aW1hZ2U=',
          },
        ],
        apiKey: 'test-api-key',
      }
      const rawInputs = structuredClone(inputs)
      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([
        expect.objectContaining({ name: '{{FILE_NAME}}.txt', base64: 'aW1hZ2U=' }),
      ])
      expect(inputs).toEqual(rawInputs)
    })

    it('rejects resolver-derived inline attachment bytes instead of corrupting base64', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FILE_BYTES', plaintext: 'aW1hZ2U=', encryptedValue: 'encrypted-bytes' },
      ])
      const inputPath = ['files', '0', 'base64'] as const
      registry.recordResolvedAtInputPath('FILE_BYTES', 'aW1hZ2U=', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'aW1hZ2U=', '{{FILE_BYTES}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Analyze this file',
          files: [
            {
              id: 'file-1',
              key: 'workspace/ws-1/example.png',
              name: 'example.png',
              size: 5,
              type: 'image/png',
              base64: 'aW1hZ2U=',
            },
          ],
        })
      ).rejects.toThrow('Agent inline file content cannot contain secret references')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('projects an inbound message document name without mutating the raw message', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FILE_NAME', plaintext: 'private.pdf', encryptedValue: 'encrypted-name' },
      ])
      const inputPath = ['messages', '0', 'files', '0', 'name'] as const
      registry.recordResolvedAtInputPath('FILE_NAME', 'private.pdf', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'private.pdf', '{{FILE_NAME}}')
      mockContext.resolvedSecretTraceRegistry = registry
      mockGetProviderFromModel.mockReturnValue('openai')
      const inputs = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user' as const,
            content: 'Read this document',
            files: [
              {
                id: 'file-1',
                key: 'workspace/ws-1/private.pdf',
                name: 'private.pdf',
                size: 5,
                type: 'application/pdf',
                base64: 'JVBERi0=',
              },
            ],
          },
        ],
      }
      const rawInputs = structuredClone(inputs)
      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages[0].files).toEqual([
        expect.objectContaining({ name: '{{FILE_NAME}}.pdf', base64: 'JVBERi0=' }),
      ])
      expect(inputs).toEqual(rawInputs)
    })

    it.each([
      'url/https://example.com/image.png',
      '',
      'provider-file-id',
      'profile-pictures/avatar.png',
    ])('preserves inline bytes for an actorless request with key %s', async (key) => {
      mockGetProviderFromModel.mockReturnValue('openai')
      await handler.execute(
        {
          ...mockContext,
          principal: {
            kind: 'system',
            serviceId: 'chat',
            workspaceId: 'test-workspace',
            workflowId: 'test-workflow',
          },
          executorDelegationOrigin: undefined,
        },
        mockBlock,
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'Analyze this image',
              files: [
                {
                  id: 'file-1',
                  key,
                  name: 'image.png',
                  url: 'https://example.com/image.png',
                  size: 5,
                  type: 'image/png',
                  base64: 'aW1hZ2U=',
                },
              ],
            },
          ],
          apiKey: 'test-api-key',
        }
      )
      expect(mockExecuteProviderRequest.mock.calls[0][1].messages[0].files).toEqual([
        expect.objectContaining({ base64: 'aW1hZ2U=' }),
      ])
    })

    it.each([
      { safe: false, includeSafeFile: false },
      { safe: false, includeSafeFile: true },
      { safe: true, includeSafeFile: true },
    ])(
      'continues after document contributor admission (safe=$safe, mixed=$includeSafeFile)',
      async ({ safe, includeSafeFile }) => {
        const key = 'workspace/ws-1/report.pdf'
        mockContext.workspaceId = 'ws-1'
        const hydrationSpy = vi
          .spyOn(userFileBase64, 'hydrateUserFilesWithBase64')
          .mockImplementationOnce(async (files, options) => {
            await options.onServableFileContributors?.(files[0], [
              {
                fileId: 'image-1',
                key: 'workspace/ws-1/image-1.png',
                context: 'workspace',
                contentUpdatedAt: new Date('2026-08-06T00:00:00.000Z'),
              },
            ])
            return files.map((file) => ({ ...file, base64: 'JVBERi0=' }))
          })
        mockImportWorkspaceFileSecretProvenanceForModelView.mockResolvedValueOnce(safe)

        try {
          mockGetProviderFromModel.mockReturnValue('openai')

          await handler.execute(mockContext, mockBlock, {
            model: 'gpt-4o',
            userPrompt: 'Analyze this document',
            files: [
              {
                id: 'file-1',
                name: 'report.pdf',
                path: `/api/files/serve/${encodeURIComponent(key)}?context=workspace`,
                key,
                size: 128,
                type: 'text/x-python-pdf',
              },
              ...(includeSafeFile
                ? [
                    {
                      id: 'file-2',
                      name: 'safe.pdf',
                      path: '/safe.pdf',
                      key: 'workspace/ws-1/safe.pdf',
                      size: 128,
                      type: 'application/pdf',
                    },
                  ]
                : []),
            ],
            apiKey: 'test-api-key',
          })

          expect(mockExecuteProviderRequest).toHaveBeenCalledOnce()
          const sent = mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)
          expect(sent.files.map((file: { id: string }) => file.id)).toEqual([
            ...(safe ? ['file-1'] : []),
            ...(includeSafeFile ? ['file-2'] : []),
          ])
          if (safe) {
            expect(sent.content).toBe('Analyze this document')
          } else {
            expect(sent.content).toMatch(
              /^Analyze this document\n\nAttachment error: 1 requested file attachment was not provided/
            )
            expect(JSON.stringify(sent)).not.toContain(key)
          }
          expect(mockImportWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
            expect.objectContaining({
              workspaceId: mockContext.workspaceId,
              view: 'opaque',
              identity: expect.objectContaining({ fileId: 'image-1' }),
            })
          )
        } finally {
          hydrationSpy.mockRestore()
        }
      }
    )

    it('should reject files for providers without attachment support', async () => {
      const inputs = {
        model: 'deepseek-chat',
        messages: [{ role: 'user' as const, content: 'Analyze this file' }],
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
            size: 128,
            type: 'image/png',
            base64: 'aW1hZ2U=',
          },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('deepseek')

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'File attachments are not supported for provider "deepseek"'
      )
    })

    it('should preserve usageControl for custom tools and filter out "none"', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test custom tools with different usageControl settings',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Auto Tool',
            code: 'return { result: "auto tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'auto_tool',
                description: 'Custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'custom-tool',
            title: 'Force Tool',
            code: 'return { result: "force tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'force_tool',
                description: 'Custom tool with forced usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'force' as const,
          },
          {
            type: 'custom-tool',
            title: 'None Tool',
            code: 'return { result: "none tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'none_tool',
                description: 'Custom tool that should be filtered out',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'none' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const tools = providerCall[1].tools

      expect(tools.length).toBe(2)

      const autoTool = tools.find(
        (t: { id?: string; usageControl?: string }) => t.id === 'custom_Auto Tool'
      )
      const forceTool = tools.find(
        (t: { id?: string; usageControl?: string }) => t.id === 'custom_Force Tool'
      )
      const noneTool = tools.find(
        (t: { id?: string; usageControl?: string }) => t.id === 'custom_None Tool'
      )

      expect(autoTool).toBeDefined()
      expect(forceTool).toBeDefined()
      expect(noneTool).toBeUndefined()

      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')
    })

    /**
     * `schema.function.name` has no uniqueness constraint — only the tool title
     * does — so two custom tools can declare the same one. The model-facing
     * function name is the tool's `id` (`custom_<title>`), never that field, so
     * the declarations stay distinguishable at the agent boundary.
     */
    it('keeps two custom tools distinguishable when their schemas declare one name', async () => {
      const declaration = (name: string) => ({
        function: {
          name,
          description: 'Collides on the declared function name',
          parameters: { type: 'object', properties: { input: { type: 'string' } } },
        },
      })
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tools provided.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'First Tool',
            code: 'return {}',
            schema: declaration('collides'),
            usageControl: 'auto' as const,
          },
          {
            type: 'custom-tool',
            title: 'Second Tool',
            code: 'return {}',
            schema: declaration('collides'),
            usageControl: 'auto' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const tools = mockExecuteProviderRequest.mock.calls[0][1].tools as Array<{ id: string }>
      expect(tools.length).toBe(2)
      expect(new Set(tools.map((tool) => tool.id)).size).toBe(2)
      expect(tools.map((tool) => tool.id).sort()).toEqual([
        'custom_First Tool',
        'custom_Second Tool',
      ])
    })

    it('uses the resolved canonical tool mode expression before filtering tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the enabled tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'force' as const,
            usageControlExpression: 'none',
          },
          {
            id: 'tool_2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'none' as const,
            usageControlExpression: ' Force ',
          },
        ],
      }
      const block = {
        ...mockBlock,
        canonicalModes: {
          '0:agentToolUsageControl': 'advanced' as const,
          '1:agentToolUsageControl': 'advanced' as const,
        },
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, block, inputs)

      expect(mockExecuteProviderRequest.mock.calls[0][1].tools).toEqual([
        expect.objectContaining({ id: 'transformed_tool_2', usageControl: 'force' }),
      ])
    })

    it.each([
      ['unsupported word', 'sometimes'],
      ['empty string', ''],
      ['whitespace', ' \n\t '],
      ['missing value', undefined],
      ['null', null],
      ['number', 0],
      ['boolean', true],
      ['empty array', []],
      ['array containing a valid mode', ['force']],
      ['object containing a valid mode', { mode: 'force' }],
      ['quoted mode', '"force"'],
      ['unresolved reference', '<start.missing>'],
      ['multiple modes', 'force\nnone'],
      ['unicode lookalike', 'ＦＯＲＣＥ'],
      ['invisible prefix', '\u200bforce'],
      ['oversized resolved value', 'force'.repeat(1024)],
    ])('rejects %s before provider or tool work', async (_label, usageControlExpression) => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tool.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto' as const,
            usageControlExpression,
          },
        ],
      }
      const block = {
        ...mockBlock,
        canonicalModes: { '0:agentToolUsageControl': 'advanced' as const },
      }

      await expect(handler.execute(mockContext, block, inputs)).rejects.toThrow(
        'Tool 1 mode must resolve to Auto, Force, or None'
      )
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
      expect(mockTransformBlockTool).not.toHaveBeenCalled()
      expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).not.toHaveBeenCalled()
      expect(mockDiscoverMcpServerToolsAsExecutor).not.toHaveBeenCalled()
    })

    it('settles a secret-derived permission without sending its expression to the provider', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'QA_TOOL_MODE', plaintext: 'force', encryptedValue: 'encrypted-mode' },
      ])
      const path = ['tools', '0', 'usageControlExpression'] as const
      registry.recordResolvedAtInputPath('QA_TOOL_MODE', 'force', path)
      registry.recordResolvedInputProjection(path, 'force', '{{QA_TOOL_MODE}}')
      mockContext.resolvedSecretTraceRegistry = registry
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tool.',
        apiKey: 'test-api-key',
        tools: [{ id: 'tool_1', type: 'tool-type-1', usageControlExpression: 'force' }],
      }

      await handler.execute(
        mockContext,
        { ...mockBlock, canonicalModes: { '0:agentToolUsageControl': 'advanced' } },
        inputs
      )

      const providerTools = mockExecuteProviderRequest.mock.calls[0][1].tools
      expect(providerTools).toEqual([expect.objectContaining({ usageControl: 'force' })])
      expect(providerTools[0]).not.toHaveProperty('usageControlExpression')
      expect(JSON.stringify(providerTools)).not.toContain('QA_TOOL_MODE')
      expect(inputs.tools[0].usageControlExpression).toBe('{{QA_TOOL_MODE}}')
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
    })

    it('keeps original tool inputs intact after a provider error and resolves the next run afresh', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the enabled tool.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'none' as const,
            usageControlExpression: 'force',
          },
        ],
      }
      const originalInputs = structuredClone(inputs)
      const block = {
        ...mockBlock,
        canonicalModes: { '0:agentToolUsageControl': 'advanced' as const },
      }
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('Provider unavailable'))

      await expect(handler.execute(mockContext, block, inputs)).rejects.toThrow(
        'Provider unavailable'
      )
      expect(inputs).toEqual(originalInputs)
      expect(mockExecuteProviderRequest.mock.calls[0][1].tools).toEqual([
        expect.objectContaining({ usageControl: 'force' }),
      ])

      await handler.execute(mockContext, block, {
        ...inputs,
        tools: [{ ...inputs.tools[0], usageControlExpression: 'none' }],
      })

      expect(mockExecuteProviderRequest.mock.calls[1][1].tools).toEqual([])
      expect(inputs).toEqual(originalInputs)
    })

    it('projects only resolver-recorded Agent text and keeps equal public text unchanged', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'x', encryptedValue: 'encrypted-token' },
      ])
      registry.recordResolvedAtInputPath('TOKEN', 'x', ['userPrompt'])
      registry.recordResolvedInputProjection(['userPrompt'], 'Box x', 'Box {{TOKEN}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        systemPrompt: 'Box eSign stays public',
        userPrompt: 'Box x',
      })

      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      expect(providerRequest.messages).toEqual([
        { role: 'system', content: 'Box eSign stays public' },
        { role: 'user', content: 'Box {{TOKEN}}' },
      ])
      expect(runtimeContext.resolvedSecretTraceRegistry.getActiveMatches()).toEqual([])
    })

    it('binds prompt-exposed placeholders to each provider tool for runtime rebinding', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TEST_API_KEY_PERSONAL',
          plaintext: 'personal-secret-value',
          encryptedValue: 'encrypted-personal-secret',
        },
      ])
      registry.recordResolvedAtInputPath('TEST_API_KEY_PERSONAL', 'personal-secret-value', [
        'userPrompt',
      ])
      registry.recordResolvedInputProjection(
        ['userPrompt'],
        'Use personal-secret-value',
        'Use {{TEST_API_KEY_PERSONAL}}'
      )
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Use personal-secret-value',
        tools: [
          {
            type: 'custom-tool',
            title: 'canary',
            schema: {
              function: {
                name: 'canary',
                parameters: {
                  type: 'object',
                  properties: { secret: { type: 'string' } },
                  required: ['secret'],
                },
              },
            },
          },
        ],
      })

      const [, providerRequest] = mockExecuteProviderRequest.mock.calls[0]
      const modelInputRegistry = getProviderToolModelInputRegistry(providerRequest.tools[0])
      expect(providerRequest.messages).toEqual([
        { role: 'user', content: 'Use {{TEST_API_KEY_PERSONAL}}' },
      ])
      expect(
        modelInputRegistry?.resolveModelExposedEnvReferences({
          secret: '{{TEST_API_KEY_PERSONAL}}',
        })
      ).toMatchObject({
        complete: true,
        matched: true,
        value: { secret: 'personal-secret-value' },
      })
    })

    it('does not carry a projected system prompt into Agent output provenance', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'x', encryptedValue: 'encrypted-token' },
      ])
      registry.recordResolvedAtInputPath('TOKEN', 'x', ['systemPrompt'])
      registry.recordResolvedInputProjection(['systemPrompt'], 'Use x', 'Use {{TOKEN}}')
      mockContext.resolvedSecretTraceRegistry = registry
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Box',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: [],
        cost: 0.001,
        timing: { total: 100 },
      })

      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'Use x',
        userPrompt: 'Continue',
      }
      const result = await handler.execute(mockContext, mockBlock, inputs)

      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      expect(providerRequest.messages).toEqual([
        { role: 'system', content: 'Use {{TOKEN}}' },
        { role: 'user', content: 'Continue' },
      ])
      expect(runtimeContext.resolvedSecretTraceRegistry.getActiveMatches()).toEqual([])
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      expect(inputs.systemPrompt).toBe('Use x')
      expect(
        mockContext.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(result)
      ).toEqual({ version: 1, complete: true, entries: [] })
    })

    it('projects exact message call arguments without mutating protocol structure or raw input', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FUNCTION_ARG', plaintext: 'first-secret', encryptedValue: 'encrypted-first' },
        { name: 'TOOL_ARG', plaintext: 'second-secret', encryptedValue: 'encrypted-second' },
        { name: 'UNUSED', plaintext: 'x', encryptedValue: 'encrypted-unused' },
      ])
      const functionPath = ['messages', '0', 'function_call', 'arguments'] as const
      const toolPath = ['messages', '0', 'tool_calls', '0', 'function', 'arguments'] as const
      registry.recordResolvedAtInputPath('FUNCTION_ARG', 'first-secret', functionPath)
      registry.recordResolvedInputProjection(
        functionPath,
        '{"token":"first-secret","public":"x"}',
        '{"token":"{{FUNCTION_ARG}}","public":"x"}'
      )
      registry.recordResolvedAtInputPath('TOOL_ARG', 'second-secret', toolPath)
      registry.recordResolvedInputProjection(
        toolPath,
        '{"token":"second-secret"}',
        '{"token":"{{TOOL_ARG}}"}'
      )
      mockContext.resolvedSecretTraceRegistry = registry
      const inputs = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'assistant' as const,
            content: 'Public x stays unchanged',
            function_call: {
              name: 'legacy_lookup',
              arguments: '{"token":"first-secret","public":"x"}',
            },
            tool_calls: [
              {
                id: 'call-1',
                type: 'function' as const,
                function: { name: 'lookup', arguments: '{"token":"second-secret"}' },
              },
            ],
          },
        ],
      }
      const rawInputs = structuredClone(inputs)
      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages[0]).toEqual({
        role: 'assistant',
        content: 'Public x stays unchanged',
        function_call: {
          name: 'legacy_lookup',
          arguments: '{"token":"{{FUNCTION_ARG}}","public":"x"}',
        },
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"token":"{{TOOL_ARG}}"}' },
          },
        ],
      })
      expect(inputs).toEqual(rawInputs)
    })

    it('rejects an exact secret-derived message protocol identifier', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'CALL_ID', plaintext: 'private-call', encryptedValue: 'encrypted-call-id' },
      ])
      const inputPath = ['messages', '0', 'tool_calls', '0', 'id'] as const
      registry.recordResolvedAtInputPath('CALL_ID', 'private-call', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'private-call', '{{CALL_ID}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          messages: [
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'private-call',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
          ],
        })
      ).rejects.toThrow('Agent structural model inputs cannot contain secret references')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('binds a resolved tool preset without activating it before the exact tool runs', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'API_KEY', plaintext: 'x', encryptedValue: 'encrypted-api-key' },
      ])
      const inputPath = ['tools', '0', 'params', 'apiKey'] as const
      registry.recordResolvedAtInputPath('API_KEY', 'x', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'x', '{{API_KEY}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Use the configured tool.',
        tools: [
          {
            type: 'custom-tool',
            title: 'lookup',
            schema: {
              function: {
                name: 'lookup',
                parameters: { type: 'object', properties: {} },
              },
            },
            params: { apiKey: 'x' },
          },
        ],
      })

      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      const providerTool = providerRequest.tools[0]
      expect(providerTool.params).toEqual({ apiKey: 'x' })
      expect(providerTool).not.toHaveProperty('__resolvedSecretTraceProvenance')
      expect(getProviderToolInputProvenance(providerTool)).toEqual({
        registry,
        sourcePath: ['tools', '0', 'params'],
        projectedParams: { apiKey: '{{API_KEY}}' },
      })
      expect(runtimeContext.resolvedSecretTraceRegistry).not.toBe(registry)
      expect(runtimeContext.resolvedSecretTraceRegistry.getActiveMatches()).toEqual([])
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
    })

    it('projects only resolver-recorded inline and cached tool metadata for the model', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'CUSTOM_DESCRIPTION',
          plaintext: 'custom-secret',
          encryptedValue: 'encrypted-custom-description',
        },
        {
          name: 'CUSTOM_PARAMETER',
          plaintext: 'custom-parameter-secret',
          encryptedValue: 'encrypted-custom-parameter',
        },
        {
          name: 'MCP_PARAMETER',
          plaintext: 'mcp-parameter-secret',
          encryptedValue: 'encrypted-mcp-parameter',
        },
        {
          name: 'MCP_SERVER_LABEL',
          plaintext: 'private-label',
          encryptedValue: 'encrypted-mcp-server-label',
        },
        { name: 'UNUSED', plaintext: 'x', encryptedValue: 'encrypted-unused' },
      ])
      const projections = [
        {
          name: 'CUSTOM_DESCRIPTION',
          plaintext: 'custom-secret',
          path: ['tools', '0', 'schema', 'function', 'description'],
          raw: 'Use custom-secret for Box',
          projected: 'Use {{CUSTOM_DESCRIPTION}} for Box',
        },
        {
          name: 'CUSTOM_PARAMETER',
          plaintext: 'custom-parameter-secret',
          path: [
            'tools',
            '0',
            'schema',
            'function',
            'parameters',
            'properties',
            'query',
            'description',
          ],
          raw: 'Query custom-parameter-secret',
          projected: 'Query {{CUSTOM_PARAMETER}}',
        },
        {
          name: 'MCP_PARAMETER',
          plaintext: 'mcp-parameter-secret',
          path: ['tools', '1', 'schema', 'properties', 'query', 'description'],
          raw: 'Search mcp-parameter-secret',
          projected: 'Search {{MCP_PARAMETER}}',
        },
        {
          name: 'MCP_SERVER_LABEL',
          plaintext: 'private-label',
          path: ['tools', '1', 'params', 'serverName'],
          raw: 'Docs private-label',
          projected: 'Docs {{MCP_SERVER_LABEL}}',
        },
      ] as const
      for (const projection of projections) {
        registry.recordResolvedAtInputPath(projection.name, projection.plaintext, projection.path)
        registry.recordResolvedInputProjection(
          projection.path,
          projection.raw,
          projection.projected
        )
      }
      registry.recordResolved('UNUSED', 'x')
      mockContext.resolvedSecretTraceRegistry = registry
      mockContext.workspaceId = 'test-workspace-123'

      const tools = [
        {
          type: 'custom-tool',
          title: 'lookup',
          schema: {
            function: {
              name: 'lookup',
              description: 'Use custom-secret for Box',
              parameters: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Query custom-parameter-secret',
                    enum: ['x', 'safe'],
                  },
                },
                required: ['query'],
              },
            },
          },
        },
        {
          type: 'mcp',
          schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search mcp-parameter-secret' },
            },
            required: ['query'],
          },
          params: {
            serverId: 'mcp-search-server',
            toolName: 'search_files',
            serverName: 'Docs private-label',
          },
        },
      ]
      const rawTools = structuredClone(tools)

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Use Box without changing it.',
        tools,
      })

      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      expect(providerRequest.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'custom_lookup',
            description: 'Use {{CUSTOM_DESCRIPTION}} for Box',
            parameters: expect.objectContaining({
              properties: {
                query: {
                  type: 'string',
                  description: 'Query {{CUSTOM_PARAMETER}}',
                  enum: ['x', 'safe'],
                },
              },
            }),
          }),
          expect.objectContaining({
            id: expect.stringContaining('search_files'),
            description: 'Live search_files',
            parameters: expect.objectContaining({
              properties: {
                query: { type: 'string' },
                path: { type: 'string' },
              },
            }),
          }),
        ])
      )
      expect(tools).toEqual(rawTools)
      expect(runtimeContext.resolvedSecretTraceRegistry.getActiveMatches()).not.toContainEqual(
        expect.objectContaining({ plaintext: 'x' })
      )
    })

    it('rejects an enabled custom tool whose title resolved from a secret', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOOL_TITLE',
          plaintext: 'private-title',
          encryptedValue: 'encrypted-tool-title',
        },
      ])
      const titlePath = ['tools', '0', 'title'] as const
      registry.recordResolvedAtInputPath('TOOL_TITLE', 'private-title', titlePath)
      registry.recordResolvedInputProjection(titlePath, 'private-title', '{{TOOL_TITLE}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Use the tool.',
          tools: [
            {
              type: 'custom-tool',
              title: 'private-title',
              schema: {
                function: {
                  name: 'lookup',
                  parameters: { type: 'object', properties: {} },
                },
              },
            },
          ],
        })
      ).rejects.toThrow('Agent structural model inputs cannot contain secret references')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('rejects a resolver-recorded semantic schema value instead of changing the contract', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'ENUM_VALUE',
          plaintext: 'private-option',
          encryptedValue: 'encrypted-enum-value',
        },
      ])
      const enumPath = [
        'tools',
        '0',
        'schema',
        'function',
        'parameters',
        'properties',
        'description',
        'enum',
        '0',
      ] as const
      registry.recordResolvedAtInputPath('ENUM_VALUE', 'private-option', enumPath)
      registry.recordResolvedInputProjection(enumPath, 'private-option', '{{ENUM_VALUE}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Use the tool.',
          tools: [
            {
              type: 'custom-tool',
              title: 'lookup',
              schema: {
                function: {
                  name: 'lookup',
                  parameters: {
                    type: 'object',
                    properties: {
                      description: { type: 'string', enum: ['private-option'] },
                    },
                  },
                },
              },
            },
          ],
        })
      ).rejects.toThrow('Agent structural model inputs cannot contain secret references')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('projects a resolver-recorded nested response format leaf before provider execution', async () => {
      const responseFormat = {
        name: 'response_schema',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: 'classified' } },
        },
        strict: true,
      }
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'DESCRIPTION', plaintext: 'classified', encryptedValue: 'encrypted-description' },
      ])
      const inputPath = ['responseFormat', 'schema', 'properties', 'answer', 'description'] as const
      registry.recordResolvedAtInputPath('DESCRIPTION', 'classified', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'classified', '{{DESCRIPTION}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].responseFormat).toEqual({
        ...responseFormat,
        schema: {
          ...responseFormat.schema,
          properties: {
            answer: { type: 'string', description: '{{DESCRIPTION}}' },
          },
        },
      })
    })

    it('rejects a resolver-derived enum inside a persisted JSON response format', async () => {
      const rawResponseFormat = JSON.stringify({
        type: 'object',
        properties: { answer: { type: 'string', enum: ['classified'] } },
      })
      const projectedResponseFormat = JSON.stringify({
        type: 'object',
        properties: { answer: { type: 'string', enum: ['{{ENUM_VALUE}}'] } },
      })
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'ENUM_VALUE', plaintext: 'classified', encryptedValue: 'encrypted-enum' },
      ])
      registry.recordResolvedAtInputPath('ENUM_VALUE', 'classified', ['responseFormat'])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        rawResponseFormat,
        projectedResponseFormat
      )
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Return an answer.',
          responseFormat: rawResponseFormat,
        })
      ).rejects.toThrow('Agent model input could not be safely projected')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('does not send a resolver-recorded whole response format value to the provider', async () => {
      const responseFormat = { type: 'object', properties: { answer: { type: 'string' } } }
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'RESPONSE_FORMAT',
          plaintext: JSON.stringify(responseFormat),
          encryptedValue: 'encrypted-response-format',
        },
      ])
      registry.recordResolvedAtInputPath('RESPONSE_FORMAT', JSON.stringify(responseFormat), [
        'responseFormat',
      ])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        responseFormat,
        '{{RESPONSE_FORMAT}}'
      )
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Return an answer.',
          responseFormat,
        })
      ).rejects.toThrow('Agent model input could not be safely projected')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('aliases a resolver-derived response format name without changing the persisted input', async () => {
      const responseFormat = {
        name: 'private-schema',
        schema: { type: 'object', properties: {} },
        strict: true,
      }
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FORMAT_NAME', plaintext: 'private-schema', encryptedValue: 'encrypted-name' },
      ])
      const inputPath = ['responseFormat', 'name'] as const
      registry.recordResolvedAtInputPath('FORMAT_NAME', 'private-schema', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'private-schema', '{{FORMAT_NAME}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].responseFormat).toEqual({
        name: 'response_schema',
        schema: { type: 'object', properties: {} },
        strict: true,
      })
      expect(JSON.stringify(mockExecuteProviderRequest.mock.calls[0][1])).not.toContain(
        'private-schema'
      )
      expect(JSON.stringify(mockExecuteProviderRequest.mock.calls[0][1])).not.toContain(
        'FORMAT_NAME'
      )
      expect(responseFormat).toEqual({
        name: 'private-schema',
        schema: { type: 'object', properties: {} },
        strict: true,
      })
    })

    it('excludes projected persisted response format fields from block output provenance', async () => {
      const responseFormat = JSON.stringify({
        name: 'x',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: 'classified' } },
        },
        strict: true,
      })
      const projectedResponseFormat = JSON.stringify({
        name: '{{FORMAT_NAME}}',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: '{{DESCRIPTION}}' } },
        },
        strict: true,
      })
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FORMAT_NAME', plaintext: 'x', encryptedValue: 'encrypted-name' },
        {
          name: 'DESCRIPTION',
          plaintext: 'classified',
          encryptedValue: 'encrypted-description',
        },
      ])
      registry.recordResolvedAtInputPath('FORMAT_NAME', 'x', ['responseFormat'])
      registry.recordResolvedAtInputPath('DESCRIPTION', 'classified', ['responseFormat'])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        responseFormat,
        projectedResponseFormat
      )
      mockContext.resolvedSecretTraceRegistry = registry
      const handlerInputs = {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      }

      await handler.execute(mockContext, mockBlock, handlerInputs)

      expect(mockExecuteProviderRequest.mock.calls[0][1].responseFormat).toEqual({
        name: 'response_schema',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: '{{DESCRIPTION}}' } },
        },
        strict: true,
      })
      const modelRegistry = mockExecuteProviderRequest.mock.calls[0][2]
        .resolvedSecretTraceRegistry as ResolvedSecretTraceRegistry
      const snapshot = modelRegistry.getModelEgressSnapshot()
      expect(snapshot.complete).toBe(true)
      if (!snapshot.complete) throw new Error('Expected complete model provenance')
      expect(snapshot.matches).toEqual([])
      const blockSnapshot = mockContext.resolvedSecretTraceRegistry?.getModelEgressSnapshot()
      expect(blockSnapshot?.complete).toBe(true)
      if (!blockSnapshot?.complete) throw new Error('Expected complete block provenance')
      expect(blockSnapshot.matches).toEqual([])
      expect(handlerInputs.responseFormat).toContain('{{FORMAT_NAME}}')
    })

    it('should handle invalid JSON in responseFormat gracefully', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Regular text response',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        timing: { total: 100 },
        toolCalls: [],
        cost: undefined,
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Format this output.',
        apiKey: 'test-api-key',
        responseFormat: '{invalid-json',
      }

      // Should not throw an error, but continue with default behavior
      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toEqual({
        content: 'Regular text response',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        providerTiming: { total: 100 },
        cost: undefined,
      })
    })

    /**
     * A stalled model call reaches here as the runtime's own `TimeoutError`, whose bare
     * message ("The operation timed out.") names nothing. It must become a Sim-level
     * message WITHOUT discarding the phase detail the provider attached — that detail is
     * the only thing distinguishing "never answered" from "body never completed".
     */
    it('maps a provider TimeoutError to a Sim message while keeping the phase detail', async () => {
      const inputs = { model: 'gpt-4o', userPrompt: 'hi', apiKey: 'test-api-key' }
      mockGetProviderFromModel.mockReturnValue('openai')

      // Faithful to production: providers rewrap the transport failure in a
      // ProviderError, which overwrites `name` — so only the cause still classifies it.
      const transport = new Error(
        'The operation timed out. [phase=reading-response-body elapsedMs=60001 status=200 contentLength=32116]'
      )
      transport.name = 'TimeoutError'
      const wrapped = new Error(transport.message, { cause: transport })
      wrapped.name = 'ProviderError'
      mockExecuteProviderRequest.mockRejectedValueOnce(wrapped)

      const error = await handler.execute(mockContext, mockBlock, inputs).catch((e) => e)

      expect(error.message).toContain('Provider request timed out')
      expect(error.message).toContain('phase=reading-response-body')
      expect(error.message).toContain('status=200')
    })

    it('should not duplicate system prompt if it exists in memories', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What should I do?',
        memories: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // existing system + 2 memories + user prompt

      // Check only one system message exists
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(1)
      expect(systemMessages[0].content).toBe('You are a helpful assistant.')
    })

    it('should prefix agent system message before legacy memories', async () => {
      const inputs = {
        model: 'gpt-4o',
        messages: [
          { role: 'system' as const, content: 'You are a helpful assistant.' },
          { role: 'user' as const, content: 'What should I do?' },
        ],
        memories: [
          { role: 'system', content: 'Old system message from memories.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify messages were built correctly
      // Agent system (1) + legacy memories (3) + user from messages (1) = 5
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(5)

      // Agent's system message is prefixed first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')
      // Then legacy memories (with their system message preserved)
      expect(requestBody.messages[1].role).toBe('system')
      expect(requestBody.messages[1].content).toBe('Old system message from memories.')
      expect(requestBody.messages[2].role).toBe('user')
      expect(requestBody.messages[2].content).toBe('Hello!')
      expect(requestBody.messages[3].role).toBe('assistant')
      expect(requestBody.messages[3].content).toBe('Hi there!')
      // Then user message from messages array
      expect(requestBody.messages[4].role).toBe('user')
      expect(requestBody.messages[4].content).toBe('What should I do?')
    })

    it('rediscovers MCP tools even when an editor schema is cached', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Used MCP tool successfully',
        model: 'gpt-4o',
        tokens: { input: 10, output: 10, total: 20 },
        toolCalls: [],
        timing: { total: 50 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the MCP tool',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'list_files',
            schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Directory path' },
              },
              required: ['path'],
            },
            params: {
              serverId: 'mcp-server-123',
              toolName: 'list_files',
              serverName: 'filesystem',
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const contextWithWorkspace = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
        workflowId: 'test-workflow-456',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithWorkspace, mockBlock, inputs)

      expect(mockDiscoverMcpServerToolsAsExecutor).toHaveBeenCalledOnce()
      expect(mockExecuteProviderRequest).toHaveBeenCalled()
    })

    it('passes the authorized live schema to the provider', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Tool executed',
        model: 'gpt-4o',
        tokens: { input: 10, output: 10, total: 20 },
        toolCalls: [
          {
            name: 'search_files',
            arguments: JSON.stringify({ query: 'test' }),
          },
        ],
        timing: { total: 50 },
      })

      const cachedSchema = {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      }

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Search for files',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'search_files',
            schema: cachedSchema,
            params: {
              serverId: 'mcp-search-server',
              toolName: 'search_files',
              serverName: 'search',
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const contextWithWorkspace = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
        workflowId: 'test-workflow-456',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithWorkspace, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0]
      expect(providerCallArgs[1].tools).toBeDefined()
      expect(providerCallArgs[1].tools.length).toBe(1)
      expect(providerCallArgs[1].tools[0].id).toContain('search_files')
    })

    it('forwards ordinary streaming without exposing agent events', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Stream this',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'search_files',
            schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
            params: {
              serverId: 'mcp-search-server',
              toolName: 'search_files',
              serverName: 'search',
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const streamingContext = {
        ...mockContext,
        stream: true,
        selectedOutputs: ['test-agent-block'],
      } as ExecutionContext

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(streamingContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0][1]
      expect(providerCallArgs.stream).toBe(true)
      expect(providerCallArgs.agentEvents).toBe(false)
    })

    it('expands every live tool from an explicitly selected managed MCP connection', async () => {
      const credentialId = 'mcp-cg-123456789012345678901'
      mockDiscoverMcpServerToolsAsExecutor.mockResolvedValue([
        {
          name: 'search_transcripts',
          description: 'Search transcripts',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          serverId: credentialId,
          serverName: 'Fireflies',
        },
        {
          name: 'get_transcript',
          description: 'Get one transcript',
          inputSchema: {
            type: 'object',
            properties: { transcriptId: { type: 'string' } },
            required: ['transcriptId'],
          },
          serverId: credentialId,
          serverName: 'Fireflies',
        },
      ])

      await handler.execute(
        {
          ...mockContext,
          userId: 'permission-check-user',
          workspaceId: 'test-workspace-123',
          workflowId: 'test-workflow-456',
        },
        mockBlock,
        {
          model: 'gpt-4o',
          userPrompt: 'Use Fireflies',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'mcp-server-advanced',
              params: { serverId: credentialId },
              usageControl: 'auto' as const,
            },
          ],
        }
      )

      expect(mockDiscoverMcpServerToolsAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: credentialId,
          workspaceId: 'test-workspace-123',
        })
      )
      const providerTools = mockExecuteProviderRequest.mock.calls[0][1].tools
      expect(providerTools).toEqual([
        expect.objectContaining({
          id: `${credentialId}-search_transcripts`,
          params: {},
        }),
        expect.objectContaining({
          id: `${credentialId}-get_transcript`,
          params: {},
        }),
      ])
    })

    it('rejects a blank advanced MCP server binding', async () => {
      await expect(
        handler.execute(
          {
            ...mockContext,
            workspaceId: 'test-workspace-123',
            workflowId: 'test-workflow-456',
          },
          mockBlock,
          {
            model: 'gpt-4o',
            userPrompt: 'Continue without MCP tools',
            apiKey: 'test-api-key',
            tools: [
              {
                type: 'mcp-server-advanced',
                params: { serverId: '' },
                usageControl: 'auto' as const,
              },
            ],
          }
        )
      ).rejects.toThrow('requires params.serverId')

      expect(mockDiscoverMcpServerToolsAsExecutor).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('fails before invoking the model when no advanced operations are permitted', async () => {
      mockDiscoverMcpServerToolsAsExecutor.mockResolvedValue([])
      await expect(
        handler.execute(
          { ...mockContext, workspaceId: 'test-workspace-123', workflowId: 'test-workflow-456' },
          mockBlock,
          {
            model: 'gpt-4o',
            userPrompt: 'Use MCP',
            apiKey: 'test-api-key',
            tools: [
              {
                type: 'mcp-server-advanced',
                params: { serverId: 'mcp-server-1' },
                operationPolicy: { mode: 'allow', operations: [] },
              },
            ],
          }
        )
      ).rejects.toThrow('No permitted MCP operations')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    describe('customToolId resolution - DB as source of truth', () => {
      const staleInlineSchema = {
        function: {
          name: 'formatReport',
          description: 'Formats a report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content' },
            },
            required: ['title', 'content'],
          },
        },
      }

      const dbSchema = {
        function: {
          name: 'formatReport',
          description: 'Formats a report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content' },
              format: { type: 'string', description: 'Output format' },
            },
            required: ['title', 'content', 'format'],
          },
        },
      }

      const staleInlineCode = 'return { title, content };'
      const dbCode = 'return { title, content, format };'

      function mockDBForCustomTool(toolId: string) {
        mockReadAvailableCustomToolByIdOrTitleAsExecutor.mockImplementation(
          ({ identifier }: { identifier: string }) => {
            if (identifier !== toolId) return Promise.resolve(null)
            return Promise.resolve({
              id: toolId,
              title: 'formatReport',
              schema: dbSchema,
              code: dbCode,
            })
          }
        )
      }

      function mockDBFailure() {
        mockReadAvailableCustomToolByIdOrTitleAsExecutor.mockRejectedValue(
          new Error('DB connection failed')
        )
      }

      beforeEach(() => {
        Object.defineProperty(global, 'window', {
          value: undefined,
          writable: true,
          configurable: true,
        })
        mockReadAvailableCustomToolByIdOrTitleAsExecutor.mockReset()
        mockContext.userId = 'test-user'
      })

      it('should always fetch latest schema from DB when customToolId is present', async () => {
        const toolId = 'custom-tool-123'
        mockDBForCustomTool(toolId)

        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Format a report',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'custom-tool',
              customToolId: toolId,
              title: 'formatReport',
              schema: staleInlineSchema,
              code: staleInlineCode,
              usageControl: 'auto' as const,
            },
          ],
        }

        mockGetProviderFromModel.mockReturnValue('openai')

        await handler.execute(mockContext, mockBlock, inputs)

        expect(mockExecuteProviderRequest).toHaveBeenCalled()
        const providerCall = mockExecuteProviderRequest.mock.calls[0]
        const tools = providerCall[1].tools

        expect(tools.length).toBe(1)
        // DB schema wins over stale inline — includes format param
        expect(tools[0].parameters.required).toContain('format')
        expect(tools[0].parameters.properties).toHaveProperty('format')
      })

      it('resolves a secret-backed customToolId without exposing it to the provider', async () => {
        const toolId = 'custom-tool-123'
        mockDBForCustomTool(toolId)
        const registry = new ResolvedSecretTraceRegistry([
          {
            name: 'CANARY_CUSTOM_TOOL_ID',
            plaintext: toolId,
            encryptedValue: 'encrypted-custom-tool-id',
          },
        ])
        const inputPath = ['tools', '0', 'customToolId'] as const
        registry.recordResolvedAtInputPath('CANARY_CUSTOM_TOOL_ID', toolId, inputPath)
        registry.recordResolvedInputProjection(inputPath, toolId, '{{CANARY_CUSTOM_TOOL_ID}}')
        mockContext.resolvedSecretTraceRegistry = registry
        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Format a report',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'custom-tool',
              customToolId: toolId,
              usageControl: 'auto' as const,
            },
          ],
        }

        await handler.execute(mockContext, mockBlock, inputs)

        expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).toHaveBeenCalledWith(
          expect.objectContaining({ context: mockContext, identifier: toolId, lookup: 'id' })
        )
        const providerRequest = mockExecuteProviderRequest.mock.calls[0][1]
        expect(providerRequest.tools).toHaveLength(1)
        expect(providerRequest.tools[0].id).toBe('custom_formatReport')
        expect(JSON.stringify(providerRequest.tools)).not.toContain(toolId)
        expect(JSON.stringify(providerRequest.tools)).not.toContain('CANARY_CUSTOM_TOOL_ID')
        expect(inputs.tools[0].customToolId).toBe('{{CANARY_CUSTOM_TOOL_ID}}')
        expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      })

      it('retains raw tool-call result provenance without reactivating a private selector', async () => {
        const toolId = 'x'
        const resultSecret = 'tool-result-secret'
        mockDBForCustomTool(toolId)
        const registry = new ResolvedSecretTraceRegistry([
          {
            name: 'CANARY_CUSTOM_TOOL_ID',
            plaintext: toolId,
            encryptedValue: 'encrypted-custom-tool-id',
          },
          {
            name: 'TOOL_RESULT',
            plaintext: resultSecret,
            encryptedValue: 'encrypted-tool-result',
          },
        ])
        const inputPath = ['tools', '0', 'customToolId'] as const
        registry.recordResolvedAtInputPath('CANARY_CUSTOM_TOOL_ID', toolId, inputPath)
        registry.recordResolvedInputProjection(inputPath, toolId, '{{CANARY_CUSTOM_TOOL_ID}}')
        mockContext.resolvedSecretTraceRegistry = registry
        mockExecuteProviderRequest.mockImplementationOnce((_provider, _request, runtimeContext) => {
          runtimeContext.resolvedSecretTraceRegistry.recordResolved('TOOL_RESULT', resultSecret, {
            propagated: true,
          })
          return Promise.resolve({
            content: 'done',
            model: 'mock-model',
            tokens: { input: 10, output: 20, total: 30 },
            toolCalls: [{ name: 'formatReport', result: { value: resultSecret, public: 'Box' } }],
            cost: 0.001,
            timing: { total: 100 },
          })
        })
        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Format a report',
          tools: [
            {
              type: 'custom-tool',
              customToolId: toolId,
              usageControl: 'auto' as const,
            },
          ],
        }

        const result = await handler.execute(mockContext, mockBlock, inputs)

        expect((result as { toolCalls: { list: unknown[] } }).toolCalls.list).toContainEqual(
          expect.objectContaining({ result: { value: resultSecret, public: 'Box' } })
        )
        expect(inputs.tools[0].customToolId).toBe('{{CANARY_CUSTOM_TOOL_ID}}')
        expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([
          { plaintext: resultSecret, replacement: '{{TOOL_RESULT}}' },
        ])
        expect(
          mockContext.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(result)
        ).toEqual({
          version: 1,
          complete: true,
          entries: [{ name: 'TOOL_RESULT', encryptedValue: 'encrypted-tool-result' }],
        })
      })

      it('uses a secret-backed skillId for lookup without carrying it into output provenance', async () => {
        const skillId = 'x'
        mockContext.workspaceId = 'workspace-1'
        queueTableRows(schemaMock.skill, [
          { id: skillId, name: 'Reporting', description: 'Prepare reporting workflows' },
        ])
        const registry = new ResolvedSecretTraceRegistry([
          {
            name: 'CANARY_SKILL_ID',
            plaintext: skillId,
            encryptedValue: 'encrypted-skill-id',
          },
        ])
        const inputPath = ['skills', '0', 'skillId'] as const
        registry.recordResolvedAtInputPath('CANARY_SKILL_ID', skillId, inputPath)
        registry.recordResolvedInputProjection(inputPath, skillId, '{{CANARY_SKILL_ID}}')
        mockContext.resolvedSecretTraceRegistry = registry
        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Prepare a report',
          skills: [{ skillId }],
        }

        await handler.execute(mockContext, mockBlock, inputs)

        const providerRequest = mockExecuteProviderRequest.mock.calls[0][1]
        expect(providerRequest.tools).toContainEqual(expect.objectContaining({ id: 'load_skill' }))
        expect(JSON.stringify(providerRequest.tools)).toContain('Reporting')
        expect(inputs.skills[0].skillId).toBe('{{CANARY_SKILL_ID}}')
        expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      })

      it('should fall back to inline schema when DB fetch fails and inline exists', async () => {
        mockDBFailure()

        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Format a report',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'custom-tool',
              customToolId: 'custom-tool-123',
              title: 'formatReport',
              schema: staleInlineSchema,
              code: staleInlineCode,
              usageControl: 'auto' as const,
            },
          ],
        }

        mockGetProviderFromModel.mockReturnValue('openai')

        await handler.execute(mockContext, mockBlock, inputs)

        expect(mockExecuteProviderRequest).toHaveBeenCalled()
        const providerCall = mockExecuteProviderRequest.mock.calls[0]
        const tools = providerCall[1].tools

        expect(tools.length).toBe(1)
        expect(tools[0].id).toBe('custom_formatReport')
        expect(tools[0].parameters.required).not.toContain('format')
      })
    })
  })

  describe('secret-safe diagnostics', () => {
    const privateHandler = () =>
      handler as unknown as {
        formatTools: (
          ctx: ExecutionContext,
          tools: Array<Record<string, unknown>>
        ) => Promise<unknown[]>
        handleExecutionError: (
          error: unknown,
          startTime: number,
          provider: string,
          model: string,
          ctx: ExecutionContext,
          block: SerializedBlock
        ) => void
        processStructuredResponse: (
          result: Record<string, unknown>,
          responseFormat: unknown,
          ctx: ExecutionContext
        ) => Record<string, unknown>
      }

    it('projects provider errors and internal runtime identifiers before logging', () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOKEN',
          plaintext: 'diagnostic-secret',
          encryptedValue: 'encrypted-diagnostic-secret',
        },
      ])
      registry.recordResolved('TOKEN', 'diagnostic-secret')
      const ctx = { ...mockContext, resolvedSecretTraceRegistry: registry }

      privateHandler().handleExecutionError(
        new Error('failed with diagnostic-secret __var_TOKEN __sim_runtime_test_1'),
        Date.now(),
        'diagnostic-secret',
        '__var_TOKEN',
        ctx,
        mockBlock
      )

      const serializedCalls = JSON.stringify(mockAgentLogger.error.mock.calls)
      expect(serializedCalls).not.toContain('diagnostic-secret')
      expect(serializedCalls).not.toContain('__var_')
      expect(serializedCalls).not.toContain('__sim_')
      expect(mockAgentLogger.error).toHaveBeenCalledWith(
        'Error executing provider request',
        expect.objectContaining({
          provider: '{{TOKEN}}',
          model: '{{TOKEN}}',
          errorMessage: 'failed with {{TOKEN}} {{TOKEN}} [RUNTIME_BINDING]',
        })
      )
    })

    it('fails closed to structural provider diagnostics without a complete registry', () => {
      const ctx = { ...mockContext, resolvedSecretTraceRegistry: undefined }

      privateHandler().handleExecutionError(
        new Error('untracked-secret __var_TOKEN __sim_runtime_test_1'),
        Date.now(),
        'untracked-secret',
        '__var_TOKEN',
        ctx,
        mockBlock
      )

      const metadata = mockAgentLogger.error.mock.calls.at(-1)?.[1]
      expect(metadata).toEqual(
        expect.objectContaining({
          workflowId: mockContext.workflowId,
          blockId: mockBlock.id,
          errorType: 'error',
        })
      )
      expect(metadata).not.toHaveProperty('provider')
      expect(metadata).not.toHaveProperty('model')
      expect(metadata).not.toHaveProperty('errorMessage')
      expect(JSON.stringify(mockAgentLogger.error.mock.calls)).not.toContain('untracked-secret')
      expect(JSON.stringify(mockAgentLogger.error.mock.calls)).not.toContain('__var_')
      expect(JSON.stringify(mockAgentLogger.error.mock.calls)).not.toContain('__sim_')
    })

    it('projects tool diagnostics without logging code or raw params', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOKEN',
          plaintext: 'tool-secret',
          encryptedValue: 'encrypted-tool-secret',
        },
      ])
      registry.recordResolved('TOKEN', 'tool-secret')
      const ctx = { ...mockContext, resolvedSecretTraceRegistry: registry }
      vi.spyOn(handler as never, 'createCustomTool' as never).mockRejectedValueOnce(
        new Error('tool-secret __var_TOKEN __sim_runtime_test_1') as never
      )

      await privateHandler().formatTools(ctx, [
        {
          type: 'custom-tool',
          title: 'tool-secret',
          operation: 'tool-secret',
          code: 'raw-code-must-not-be-logged',
          schema: {},
          params: {
            toolName: '__var_TOKEN',
            serverId: 'tool-secret',
            config: 'raw-config-must-not-be-logged',
          },
        },
      ])

      const serializedCalls = JSON.stringify(mockAgentLogger.error.mock.calls)
      expect(serializedCalls).not.toContain('tool-secret')
      expect(serializedCalls).not.toContain('__var_')
      expect(serializedCalls).not.toContain('__sim_')
      expect(serializedCalls).not.toContain('raw-code-must-not-be-logged')
      expect(serializedCalls).not.toContain('raw-config-must-not-be-logged')
      expect(mockAgentLogger.error).toHaveBeenCalledWith(
        '[AgentHandler] Error creating tool',
        expect.objectContaining({
          title: '{{TOKEN}}',
          operation: '{{TOKEN}}',
          toolName: '{{TOKEN}}',
          serverId: '{{TOKEN}}',
          errorMessage: '{{TOKEN}} {{TOKEN}} [RUNTIME_BINDING]',
          hasParams: true,
        })
      )
    })
  })

  describe('wrapStreamForMemoryPersistence envelope', () => {
    it.each(['Completed answer.', ''])(
      'finalizes %j even when an existing stream callback rejects',
      async (content) => {
        const finalize = vi.fn().mockResolvedValue(undefined)
        const onFullContent = vi.fn().mockRejectedValue(new Error('Callback failed'))
        const stream: StreamingExecution = {
          stream: new ReadableStream(),
          onFullContent,
          execution: {
            success: true,
            output: { content },
            logs: [],
            metadata: { startTime: '', duration: 0 },
          },
        }
        const privateHandler = handler as unknown as {
          wrapStreamForMemoryPersistence: (
            ctx: ExecutionContext,
            inputs: AgentInputs,
            stream: StreamingExecution,
            model: string,
            session: AgentTurnSession
          ) => StreamingExecution
        }
        const wrapped = privateHandler.wrapStreamForMemoryPersistence(
          mockContext,
          { model: 'gpt-4o' },
          stream,
          'gpt-4o',
          { memoryId: 'memory-1', finalize } as AgentTurnSession
        )

        await expect(wrapped.onFullContent?.(content)).resolves.toBeUndefined()
        expect(onFullContent).toHaveBeenCalledWith(content)
        expect(finalize).toHaveBeenCalledExactlyOnceWith(content, 'gpt-4o')
      }
    )
  })
})
