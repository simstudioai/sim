import {
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
import type { AutoRoutingSignals } from '@/lib/model-router/resolve'
import * as userFileBase64 from '@/lib/uploads/utils/user-file-base64.server'
import { getAllBlocks } from '@/blocks'
import { AGENT, BlockType, isMcpTool } from '@/executor/constants'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { installStreamingCostPolicy } from '@/providers/cost-policy'
import { SIM_AUTO_MODEL_ID } from '@/providers/models'
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
} = vi.hoisted(() => ({
  mockDiscoverMcpServerToolsAsExecutor: vi.fn().mockResolvedValue([]),
  mockImportWorkspaceFileSecretProvenanceForModelView: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: mockDiscoverMcpServerToolsAsExecutor,
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
  { id: 'mcp-search-server', connectionStatus: 'connected' },
  { id: 'same-server', connectionStatus: 'connected' },
  { id: 'mcp-legacy-server', connectionStatus: 'connected' },
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
    mockDiscoverMcpServerToolsAsExecutor.mockResolvedValue([])
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

  describe('canHandle', () => {
    it('should return true for blocks with metadata id "agent"', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should return false for blocks without metadata id "agent"', () => {
      const nonAgentBlock: SerializedBlock = {
        ...mockBlock,
        metadata: { id: 'other-block' },
      }
      expect(handler.canHandle(nonAgentBlock)).toBe(false)
    })

    it('should return false for blocks without metadata', () => {
      const noMetadataBlock: SerializedBlock = {
        ...mockBlock,
        metadata: undefined,
      }
      expect(handler.canHandle(noMetadataBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should execute a basic agent block request', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedOutput = {
        content: 'Mocked response content',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        providerTiming: { total: 100 },
        cost: 0.001,
      }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      expect(result).toEqual(expectedOutput)
    })

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

    it('leaves auto-routing signal projection to the shared model router boundary', () => {
      const signals = buildAutoRoutingSignalsFor({
        systemPrompt: 'Keep routing-secret-value private',
        userPrompt: 'Use routing-secret-value',
        tools: [{ title: 'routing-secret-value' }],
      }) as AutoRoutingSignals

      expect(signals.systemPrompt).toBe('Keep routing-secret-value private')
      expect(signals.lastMessage).toBe('Use routing-secret-value')
      expect(signals.toolNames).toEqual(['routing-secret-value'])
    })

    const png = { id: 'f1', type: 'image/png' }
    const pdf = { id: 'f2', type: 'application/pdf' }

    it('reports no media when neither the files input nor any message carries one', async () => {
      const signals = buildAutoRoutingSignalsFor({
        messages: [{ role: 'user' as const, content: 'Summarize this text' }],
      })

      expect(signals.mediaKind).toBe('none')
    })

    it('detects media carried on inbound messages, not just the files input', async () => {
      const signals = buildAutoRoutingSignalsFor({
        messages: [{ role: 'user' as const, content: 'What is in this image?', files: [png] }],
      })

      expect(signals.mediaKind).toBe('image')
    })

    it('classifies an all-image attachment set as image', async () => {
      expect(buildAutoRoutingSignalsFor({ files: [png, png] }).mediaKind).toBe('image')
    })

    it('classifies a mixed image + document set as file', async () => {
      expect(buildAutoRoutingSignalsFor({ files: [png, pdf] }).mediaKind).toBe('file')
    })

    it('treats an unknown MIME type as file rather than assuming it is an image', async () => {
      expect(buildAutoRoutingSignalsFor({ files: [{ id: 'f3' }] }).mediaKind).toBe('file')
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

    it('leaves the reported model alone for an explicitly selected model', async () => {
      const result = (await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Hello!',
        apiKey: 'test-api-key',
      })) as { model: string }

      expect(result.model).toBe('mock-model')
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

    it('keeps ordinary direct file fields unchanged without resolver-recorded lineage', async () => {
      mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
        { name: 'UNUSED_NAME', plaintext: 'example.png', encryptedValue: 'encrypted-name' },
        { name: 'UNUSED_BYTES', plaintext: 'aW1hZ2U=', encryptedValue: 'encrypted-bytes' },
      ])
      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, {
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
        apiKey: 'test-api-key',
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([
        expect.objectContaining({ name: 'example.png', base64: 'aW1hZ2U=' }),
      ])
    })

    it('projects a resolver-recorded name inside a persisted serialized file input', async () => {
      const rawFiles = JSON.stringify([
        {
          id: 'file-1',
          key: 'workspace/ws-1/private.pdf',
          name: 'private.pdf',
          size: 5,
          type: 'application/pdf',
          base64: 'JVBERi0=',
        },
      ])
      const projectedFiles = JSON.stringify([
        {
          id: 'file-1',
          key: 'workspace/ws-1/private.pdf',
          name: '{{FILE_NAME}}',
          size: 5,
          type: 'application/pdf',
          base64: 'JVBERi0=',
        },
      ])
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FILE_NAME', plaintext: 'private.pdf', encryptedValue: 'encrypted-name' },
      ])
      registry.recordResolvedAtInputPath('FILE_NAME', 'private.pdf', ['files'])
      registry.recordResolvedInputProjection(['files'], rawFiles, projectedFiles)
      mockContext.resolvedSecretTraceRegistry = registry
      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Analyze this file',
        files: rawFiles,
        apiKey: 'test-api-key',
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([
        expect.objectContaining({ name: '{{FILE_NAME}}.pdf', base64: 'JVBERi0=' }),
      ])
    })

    it('rejects resolver-derived inline bytes inside a persisted serialized file input', async () => {
      const rawFiles = JSON.stringify([
        {
          id: 'file-1',
          key: 'workspace/ws-1/example.png',
          name: 'example.png',
          size: 5,
          type: 'image/png',
          base64: 'aW1hZ2U=',
        },
      ])
      const projectedFiles = JSON.stringify([
        {
          id: 'file-1',
          key: 'workspace/ws-1/example.png',
          name: 'example.png',
          size: 5,
          type: 'image/png',
          base64: '{{FILE_BYTES}}',
        },
      ])
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FILE_BYTES', plaintext: 'aW1hZ2U=', encryptedValue: 'encrypted-bytes' },
      ])
      registry.recordResolvedAtInputPath('FILE_BYTES', 'aW1hZ2U=', ['files'])
      registry.recordResolvedInputProjection(['files'], rawFiles, projectedFiles)
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Analyze this file',
          files: rawFiles,
          apiKey: 'test-api-key',
        })
      ).rejects.toThrow('Agent inline file content cannot contain secret references')
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('keeps a serialized file input unchanged without resolver-recorded lineage', async () => {
      const files = JSON.stringify([
        {
          id: 'file-1',
          key: 'workspace/ws-1/example.png',
          name: 'example.png',
          size: 5,
          type: 'image/png',
          base64: 'aW1hZ2U=',
        },
      ])
      mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
        { name: 'UNUSED_NAME', plaintext: 'example.png', encryptedValue: 'encrypted-name' },
        { name: 'UNUSED_BYTES', plaintext: 'aW1hZ2U=', encryptedValue: 'encrypted-bytes' },
      ])
      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Analyze this file',
        files,
        apiKey: 'test-api-key',
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([
        expect.objectContaining({ name: 'example.png', base64: 'aW1hZ2U=' }),
      ])
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

    it('normalizes the persisted workspace-picker shape before provider execution', async () => {
      const key = 'workspace/ws-1/example.png'
      const hydrationSpy = vi
        .spyOn(userFileBase64, 'hydrateUserFilesWithBase64')
        .mockImplementationOnce(async (files) =>
          files.map((file) => ({ ...file, base64: 'aW1hZ2U=' }))
        )

      try {
        mockGetProviderFromModel.mockReturnValue('openai')

        await handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Analyze this file',
          files: [
            {
              name: 'example.png',
              path: `/api/files/serve/${encodeURIComponent(key)}?context=workspace`,
              key,
              size: 128,
              type: 'image/png',
            },
          ],
          apiKey: 'test-api-key',
        })

        const normalizedFile = hydrationSpy.mock.calls[0][0][0]
        expect(normalizedFile).toMatchObject({
          id: expect.stringMatching(/^file-\d+$/),
          key,
          name: 'example.png',
          type: 'image/png',
        })
        expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([
          expect.objectContaining({ key, name: 'example.png', base64: 'aW1hZ2U=' }),
        ])
      } finally {
        hydrationSpy.mockRestore()
      }
    })

    it('omits only a generated document whose embedded contributor is not model-safe', async () => {
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
      mockImportWorkspaceFileSecretProvenanceForModelView.mockResolvedValueOnce(false)

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
          ],
          apiKey: 'test-api-key',
        })

        expect(mockExecuteProviderRequest.mock.calls[0][1].messages.at(-1)?.files).toEqual([])
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
    })

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

    it('should filter out tools with usageControl set to "none"', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tools provided.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto' as const,
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'none' as const,
          },
          {
            id: 'tool_3',
            title: 'Tool 3',
            type: 'tool-type-3',
            operation: 'operation3',
            usageControl: 'force' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      expect(requestBody.tools.length).toBe(2)

      const toolIds = requestBody.tools.map(
        (t: { name?: string; id?: string; usageControl?: string }) => t.id
      )
      expect(toolIds).toContain('transformed_tool_1')
      expect(toolIds).toContain('transformed_tool_3')
      expect(toolIds).not.toContain('transformed_tool_2')
    })

    it('should include usageControl property in transformed tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tools with different usage controls.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto' as const,
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'force' as const,
          },
        ],
      }

      mockTransformBlockTool.mockImplementation((tool: { id?: string; operation?: string }) => ({
        id: `transformed_${tool.id}`,
        name: `${tool.id}_${tool.operation}`,
        description: 'Transformed tool',
        parameters: { type: 'object', properties: {} },
      }))

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      expect(requestBody.tools[0].usageControl).toBe('auto')
      expect(requestBody.tools[1].usageControl).toBe('force')
    })

    it('should handle custom tools with usageControl properties', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the custom tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Tool - Auto',
            schema: {
              function: {
                name: 'custom_tool_auto',
                description: 'A custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - Force',
            schema: {
              function: {
                name: 'custom_tool_force',
                description: 'A custom tool with forced usage',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'force' as const,
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - None',
            schema: {
              function: {
                name: 'custom_tool_none',
                description: 'A custom tool that should not be used',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
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
      const requestBody = providerCall[1]

      expect(requestBody.tools.length).toBe(2)

      const toolNames = requestBody.tools.map((t: { id?: string; usageControl?: string }) => t.id)
      expect(toolNames).toContain('custom_Custom Tool - Auto')
      expect(toolNames).toContain('custom_Custom Tool - Force')
      expect(toolNames).not.toContain('custom_Custom Tool - None')

      const autoTool = requestBody.tools.find(
        (t: { id?: string; usageControl?: string }) => t.id === 'custom_Custom Tool - Auto'
      )
      const forceTool = requestBody.tools.find(
        (t: { id?: string; usageControl?: string }) => t.id === 'custom_Custom Tool - Force'
      )

      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')
    })

    it('should not require API key for gpt-4o on hosted version', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
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

    it('keeps only raw provider inputs active for provider error diagnostics', async () => {
      const plaintext = 'provider-credential-secret'
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'API_KEY', plaintext, encryptedValue: 'encrypted-api-key' },
        { name: 'PROMPT_TOKEN', plaintext: 'x', encryptedValue: 'encrypted-prompt-token' },
      ])
      registry.recordResolvedAtInputPath('API_KEY', plaintext, ['apiKey'])
      registry.recordResolvedInputProjection(['apiKey'], plaintext, '{{API_KEY}}')
      registry.recordResolvedAtInputPath('PROMPT_TOKEN', 'x', ['systemPrompt'])
      registry.recordResolvedInputProjection(['systemPrompt'], 'Use x', 'Use {{PROMPT_TOKEN}}')
      mockContext.resolvedSecretTraceRegistry = registry
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error(`Provider rejected ${plaintext}`))
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'Use x',
        userPrompt: 'Continue',
        apiKey: plaintext,
      }

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        `Provider rejected ${plaintext}`
      )

      expect(inputs).toMatchObject({ systemPrompt: 'Use x', apiKey: plaintext })
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      expect(mockContext.errorResolvedSecretTraceRegistry?.getActiveMatches()).toEqual([
        { plaintext, replacement: '{{API_KEY}}' },
      ])
      const logged = JSON.stringify(mockAgentLogger.error.mock.calls)
      expect(logged).not.toContain(plaintext)
      expect(logged).toContain('Provider rejected {{API_KEY}}')
      expect(logged).not.toContain('PROMPT_TOKEN')
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

    it('prunes a private selector when an earlier message structural check fails', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'CUSTOM_TOOL_ID', plaintext: 'x', encryptedValue: 'encrypted-tool-id' },
        { name: 'CALL_ID', plaintext: 'private-call', encryptedValue: 'encrypted-call-id' },
      ])
      const selectorPath = ['tools', '0', 'customToolId'] as const
      registry.recordResolvedAtInputPath('CUSTOM_TOOL_ID', 'x', selectorPath)
      registry.recordResolvedInputProjection(selectorPath, 'x', '{{CUSTOM_TOOL_ID}}')
      const callIdPath = ['messages', '0', 'tool_calls', '0', 'id'] as const
      registry.recordResolvedAtInputPath('CALL_ID', 'private-call', callIdPath)
      registry.recordResolvedInputProjection(callIdPath, 'private-call', '{{CALL_ID}}')
      mockContext.resolvedSecretTraceRegistry = registry
      const inputs = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'assistant' as const,
            content: '',
            tool_calls: [
              {
                id: 'private-call',
                type: 'function' as const,
                function: { name: 'lookup', arguments: '{}' },
              },
            ],
          },
        ],
        tools: [{ type: 'custom-tool', customToolId: 'x', usageControl: 'auto' as const }],
      }

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Agent structural model inputs cannot contain secret references'
      )

      expect(inputs.tools[0].customToolId).toBe('{{CUSTOM_TOOL_ID}}')
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([
        { plaintext: 'private-call', replacement: '{{CALL_ID}}' },
      ])
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

    it('omits a tool with unknown hidden preset provenance without blocking the public prompt', async () => {
      const registry = new ResolvedSecretTraceRegistry()
      await registry.importProvenanceForValueAtInputPath(
        { version: 1 },
        'unknown-value',
        ['tools', '0', 'params', 'apiKey'],
        { trusted: true }
      )
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
            params: { apiKey: 'unknown-value' },
          },
        ],
      })

      expect(mockExecuteProviderRequest).toHaveBeenCalledOnce()
      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      expect(providerRequest.messages).toEqual([
        { role: 'user', content: 'Use the configured tool.' },
      ])
      expect(providerRequest.tools).toEqual([])
      expect(runtimeContext.resolvedSecretTraceRegistry.isComplete()).toBe(true)
    })

    it('does not let an unrelated unknown input path block public Agent inputs', async () => {
      const registry = new ResolvedSecretTraceRegistry()
      await registry.importProvenanceForValueAtInputPath(
        { version: 1 },
        'unknown-value',
        ['unusedInput'],
        { trusted: true }
      )
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Public prompt',
      })

      expect(mockExecuteProviderRequest).toHaveBeenCalledOnce()
      const [, providerRequest, runtimeContext] = mockExecuteProviderRequest.mock.calls[0]
      expect(providerRequest.messages).toEqual([{ role: 'user', content: 'Public prompt' }])
      expect(runtimeContext.resolvedSecretTraceRegistry.isComplete()).toBe(true)
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
            description: 'MCP tool search_files from Docs {{MCP_SERVER_LABEL}}',
            parameters: expect.objectContaining({
              properties: {
                query: { type: 'string', description: 'Search {{MCP_PARAMETER}}' },
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

    it('rejects an inline custom function name resolved from a secret', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOOL_NAME',
          plaintext: 'private_name',
          encryptedValue: 'encrypted-tool-name',
        },
      ])
      const namePath = ['tools', '0', 'schema', 'function', 'name'] as const
      registry.recordResolvedAtInputPath('TOOL_NAME', 'private_name', namePath)
      registry.recordResolvedInputProjection(namePath, 'private_name', '{{TOOL_NAME}}')
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
                  name: 'private_name',
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

    it('should execute with standard block tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Analyze this data.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
        tools: [
          {
            id: 'block_tool_1',
            title: 'Data Analysis Tool',
            operation: 'analyze',
          },
        ],
      }

      const mockToolDetails = {
        id: 'block_tool_1',
        name: 'data_analysis_analyze',
        description: 'Analyzes data',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
      }

      mockTransformBlockTool.mockReturnValue(mockToolDetails)
      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedOutput = {
        content: 'Mocked response content',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: { list: [], count: 0 }, // Assuming no tool calls in this mock response
        providerTiming: { total: 100 },
        cost: 0.001,
      }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(mockTransformBlockTool).toHaveBeenCalledWith(
        inputs.tools[0],
        expect.objectContaining({ selectedOperation: 'analyze' })
      )
      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      expect(result).toEqual(expectedOutput)
    })

    it('should execute with custom tools (schema only and with code)', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the custom tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Schema Tool',
            schema: {
              function: {
                name: 'custom_schema_tool',
                description: 'A tool defined only by schema',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
          },
          {
            type: 'custom-tool',
            title: 'Custom Code Tool',
            code: 'return { result: input * 2 }',
            timeout: 1000,
            schema: {
              function: {
                name: 'custom_code_tool',
                description: 'A tool with code execution',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'number' },
                  },
                },
              },
            },
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
    })

    it('should handle responseFormat with valid JSON', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: '{"result": "Success", "score": 0.95}',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        timing: { total: 100 },
        toolCalls: [],
        cost: undefined,
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test context',
        apiKey: 'test-api-key',
        responseFormat:
          '{"type":"object","properties":{"result":{"type":"string"},"score":{"type":"number"}}}',
      }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toEqual({
        result: 'Success',
        score: 0.95,
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        providerTiming: { total: 100 },
        cost: undefined,
      })
    })

    it('keeps an ordinary response format unchanged without resolver-recorded lineage', async () => {
      const responseFormat = {
        name: 'response_schema',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: 'x' } },
        },
        strict: true,
      }
      mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
        { name: 'UNUSED', plaintext: 'x', encryptedValue: 'encrypted-unused' },
      ])

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].responseFormat).toEqual(responseFormat)
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

    it('projects a resolver-recorded annotation inside a persisted JSON response format', async () => {
      const rawResponseFormat = JSON.stringify({
        type: 'object',
        properties: { answer: { type: 'string', description: 'classified' } },
      })
      const projectedResponseFormat = JSON.stringify({
        type: 'object',
        properties: { answer: { type: 'string', description: '{{DESCRIPTION}}' } },
      })
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'DESCRIPTION', plaintext: 'classified', encryptedValue: 'encrypted-description' },
      ])
      registry.recordResolvedAtInputPath('DESCRIPTION', 'classified', ['responseFormat'])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        rawResponseFormat,
        projectedResponseFormat
      )
      mockContext.resolvedSecretTraceRegistry = registry

      await handler.execute(mockContext, mockBlock, {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat: rawResponseFormat,
      })

      expect(mockExecuteProviderRequest.mock.calls[0][1].responseFormat).toEqual({
        name: 'response_schema',
        schema: JSON.parse(projectedResponseFormat),
        strict: true,
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

    it('rejects a resolver-derived response schema enum instead of changing the contract', async () => {
      const responseFormat = {
        name: 'response_schema',
        schema: {
          type: 'object',
          properties: {
            description: { type: 'string', enum: ['private-option'] },
          },
        },
        strict: true,
      }
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'ENUM_VALUE',
          plaintext: 'private-option',
          encryptedValue: 'encrypted-option',
        },
      ])
      const inputPath = [
        'responseFormat',
        'schema',
        'properties',
        'description',
        'enum',
        '0',
      ] as const
      registry.recordResolvedAtInputPath('ENUM_VALUE', 'private-option', inputPath)
      registry.recordResolvedInputProjection(inputPath, 'private-option', '{{ENUM_VALUE}}')
      mockContext.resolvedSecretTraceRegistry = registry

      await expect(
        handler.execute(mockContext, mockBlock, {
          model: 'gpt-4o',
          userPrompt: 'Return an answer.',
          responseFormat,
        })
      ).rejects.toThrow('Agent structural model inputs cannot contain secret references')
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

    it('prunes a private response format name when another structural field fails', async () => {
      const responseFormat = {
        name: 'x',
        schema: { type: 'object', properties: {} },
        strict: 'locked',
      }
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FORMAT_NAME', plaintext: 'x', encryptedValue: 'encrypted-name' },
        { name: 'STRICT_VALUE', plaintext: 'locked', encryptedValue: 'encrypted-strict' },
      ])
      const namePath = ['responseFormat', 'name'] as const
      registry.recordResolvedAtInputPath('FORMAT_NAME', 'x', namePath)
      registry.recordResolvedInputProjection(namePath, 'x', '{{FORMAT_NAME}}')
      const strictPath = ['responseFormat', 'strict'] as const
      registry.recordResolvedAtInputPath('STRICT_VALUE', 'locked', strictPath)
      registry.recordResolvedInputProjection(strictPath, 'locked', '{{STRICT_VALUE}}')
      mockContext.resolvedSecretTraceRegistry = registry
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      }

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Agent structural model inputs cannot contain secret references'
      )

      expect(inputs.responseFormat).toEqual({
        name: '{{FORMAT_NAME}}',
        schema: { type: 'object', properties: {} },
        strict: '{{STRICT_VALUE}}',
      })
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('prunes a private name from serialized response format before a structural failure', async () => {
      const responseFormat = JSON.stringify({
        name: 'x',
        schema: { type: 'object', properties: {} },
        strict: 'locked',
      })
      const projectedResponseFormat = JSON.stringify({
        name: '{{FORMAT_NAME}}',
        schema: { type: 'object', properties: {} },
        strict: '{{STRICT_VALUE}}',
      })
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FORMAT_NAME', plaintext: 'x', encryptedValue: 'encrypted-name' },
        { name: 'STRICT_VALUE', plaintext: 'locked', encryptedValue: 'encrypted-strict' },
      ])
      registry.recordResolvedAtInputPath('FORMAT_NAME', 'x', ['responseFormat'])
      registry.recordResolvedAtInputPath('STRICT_VALUE', 'locked', ['responseFormat'])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        responseFormat,
        projectedResponseFormat
      )
      mockContext.resolvedSecretTraceRegistry = registry
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Return an answer.',
        responseFormat,
      }

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Agent model input could not be safely projected'
      )

      expect(inputs.responseFormat).toBe(projectedResponseFormat)
      expect(inputs.responseFormat).toContain('"strict":"{{STRICT_VALUE}}"')
      expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('aliases a resolver-derived name inside a persisted JSON response format', async () => {
      const responseFormat = JSON.stringify({
        name: 'private-schema',
        schema: { type: 'object', properties: {} },
        strict: true,
      })
      const projectedResponseFormat = JSON.stringify({
        name: '{{FORMAT_NAME}}',
        schema: { type: 'object', properties: {} },
        strict: true,
      })
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'FORMAT_NAME', plaintext: 'private-schema', encryptedValue: 'encrypted-name' },
      ])
      registry.recordResolvedAtInputPath('FORMAT_NAME', 'private-schema', ['responseFormat'])
      registry.recordResolvedInputProjection(
        ['responseFormat'],
        responseFormat,
        projectedResponseFormat
      )
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
      expect(responseFormat).toContain('private-schema')
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

    it('should handle responseFormat when it is an empty string', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Regular text response',
        model: 'mock-model',
        tokens: { input: 10, output: 20, total: 30 },
        timing: { total: 100 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test context',
        apiKey: 'test-api-key',
        responseFormat: '', // Empty string
      }

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

    it('should handle variable references in responseFormat gracefully', async () => {
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
        responseFormat: '<start.input>',
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

    it('should handle errors from the provider request', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'This will fail.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
      }

      mockGetProviderFromModel.mockReturnValue('openai')
      mockExecuteProviderRequest.mockRejectedValueOnce(new Error('Provider API Error'))

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Provider API Error'
      )
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

    it('maps a provider AbortError the same way', async () => {
      const inputs = { model: 'gpt-4o', userPrompt: 'hi', apiKey: 'test-api-key' }
      mockGetProviderFromModel.mockReturnValue('openai')

      const aborted = new Error('aborted [phase=awaiting-response-headers elapsedMs=12]')
      aborted.name = 'AbortError'
      const wrapped = new Error(aborted.message, { cause: aborted })
      wrapped.name = 'ProviderError'
      mockExecuteProviderRequest.mockRejectedValueOnce(wrapped)

      const error = await handler.execute(mockContext, mockBlock, inputs).catch((e) => e)

      expect(error.message).toContain('Provider request timed out')
      expect(error.message).toContain('phase=awaiting-response-headers')
    })

    it('should handle streaming responses with text/event-stream content type', async () => {
      const mockStreamBody = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockExecuteProviderRequest.mockResolvedValueOnce({
        stream: mockStreamBody,
        execution: {
          success: true,
          output: {},
          logs: [],
          metadata: {
            duration: 0,
            startTime: new Date().toISOString(),
          },
        },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Stream this response.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputs = [mockBlock.id]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution).toHaveProperty('success', true)
      expect((result as StreamingExecution).execution).toHaveProperty('output')
      expect((result as StreamingExecution).execution.output).toBeDefined()
      expect((result as StreamingExecution).execution).toHaveProperty('logs')
    })

    it('should handle streaming responses with execution data in header', async () => {
      const mockStreamBody = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      const mockExecutionData = {
        success: true,
        output: {
          content: '',
          model: 'mock-model',
          tokens: { input: 10, output: 20, total: 30 },
        },
        logs: [
          {
            blockId: 'some-id',
            blockType: BlockType.AGENT,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 100,
            success: true,
          },
        ],
        metadata: {
          startTime: new Date().toISOString(),
          duration: 100,
        },
      }

      mockExecuteProviderRequest.mockResolvedValueOnce({
        stream: mockStreamBody,
        execution: mockExecutionData,
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Stream this response with execution data.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputs = [mockBlock.id]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution.success).toBe(true)
      expect((result as StreamingExecution).execution.output.model).toBe('mock-model')
      const logs = (result as StreamingExecution).execution.logs
      expect(logs?.length).toBe(1)
      if (logs && logs.length > 0 && logs[0]) {
        expect(logs[0].blockType).toBe(BlockType.AGENT)
      }
    })

    it('should handle combined stream+execution responses', async () => {
      new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockExecuteProviderRequest.mockResolvedValueOnce({
        stream: {}, // Serialized stream placeholder
        execution: {
          success: true,
          output: {
            content: 'Test streaming content',
            model: 'gpt-4o',
            tokens: { input: 10, output: 5, total: 15 },
          },
          logs: [],
          metadata: {
            startTime: new Date().toISOString(),
            duration: 150,
          },
        },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Return a combined response.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputs = [mockBlock.id]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution.success).toBe(true)
      expect((result as StreamingExecution).execution.output.content).toBe('Test streaming content')
      expect((result as StreamingExecution).execution.output.model).toBe('gpt-4o')
    })

    it('should process memories in advanced mode with system prompt and user prompt', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What did we discuss before?',
        memories: [
          { role: 'user', content: 'Hello, my name is John.' },
          { role: 'assistant', content: 'Hello John! Nice to meet you.' },
          { role: 'user', content: 'I like programming.' },
          { role: 'assistant', content: "That's great! What programming languages do you enjoy?" },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(6) // system + 4 memories + user prompt

      // Check system prompt is first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')

      // Check memories are in the middle
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello, my name is John.')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hello John! Nice to meet you.')

      // Check user prompt is last
      expect(requestBody.messages[5].role).toBe('user')
      expect(requestBody.messages[5].content).toBe('What did we discuss before?')

      // Verify system prompt and context are not included separately
      expect(requestBody.systemPrompt).toBeUndefined()
      expect(requestBody.userPrompt).toBeUndefined()
    })

    it('should handle memory block output format', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Continue our conversation.',
        memories: {
          memories: [
            {
              key: 'conversation-1',
              type: BlockType.AGENT,
              data: [
                { role: 'user', content: 'Hi there!' },
                { role: 'assistant', content: 'Hello! How can I help you?' },
              ],
            },
          ],
        },
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // system + 2 memories + user prompt

      // Check system prompt is first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')

      // Check memories from memory block
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hi there!')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hello! How can I help you?')

      // Check user prompt is last
      expect(requestBody.messages[3].role).toBe('user')
      expect(requestBody.messages[3].content).toBe('Continue our conversation.')
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

    it('should prefix agent system message and preserve legacy memory system messages', async () => {
      const inputs = {
        model: 'gpt-4o',
        messages: [
          { role: 'system' as const, content: 'You are a helpful assistant.' },
          { role: 'user' as const, content: 'Continue our conversation.' },
        ],
        memories: [
          { role: 'system', content: 'First system message.' },
          { role: 'user', content: 'Hello!' },
          { role: 'system', content: 'Second system message.' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'system', content: 'Third system message.' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(7)

      // Agent's system message prefixed first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')
      // Then legacy memories with their system messages preserved in order
      expect(requestBody.messages[1].role).toBe('system')
      expect(requestBody.messages[1].content).toBe('First system message.')
      expect(requestBody.messages[2].role).toBe('user')
      expect(requestBody.messages[2].content).toBe('Hello!')
      expect(requestBody.messages[3].role).toBe('system')
      expect(requestBody.messages[3].content).toBe('Second system message.')
      expect(requestBody.messages[4].role).toBe('assistant')
      expect(requestBody.messages[4].content).toBe('Hi there!')
      expect(requestBody.messages[5].role).toBe('system')
      expect(requestBody.messages[5].content).toBe('Third system message.')
      // Then user message from messages array
      expect(requestBody.messages[6].role).toBe('user')
      expect(requestBody.messages[6].content).toBe('Continue our conversation.')
    })

    it('should preserve multiple system messages when no explicit systemPrompt is provided', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'What should I do?',
        memories: [
          { role: 'system', content: 'First system message.' },
          { role: 'user', content: 'Hello!' },
          { role: 'system', content: 'Second system message.' },
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
      expect(requestBody.messages.length).toBe(5) // 2 system + 2 non-system memories + user prompt

      // Check that multiple system messages are preserved when no explicit systemPrompt
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(2)
      expect(systemMessages[0].content).toBe('First system message.')
      expect(systemMessages[1].content).toBe('Second system message.')

      // Verify original order is preserved
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('First system message.')
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello!')
      expect(requestBody.messages[2].role).toBe('system')
      expect(requestBody.messages[2].content).toBe('Second system message.')
      expect(requestBody.messages[3].role).toBe('assistant')
      expect(requestBody.messages[3].content).toBe('Hi there!')
      expect(requestBody.messages[4].role).toBe('user')
      expect(requestBody.messages[4].content).toBe('What should I do?')
    })

    it('should handle user prompt as object with input field', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: {
          input: 'What is the weather like?',
          conversationId: 'abc-123',
        },
        memories: [],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      // Verify user prompt content was extracted correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(2) // system + user prompt

      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('What is the weather like?')
      expect(requestBody.messages[1]).not.toHaveProperty('conversationId')
    })

    it('should pass Azure OpenAI parameters through the request pipeline', async () => {
      const inputs = {
        model: 'azure/gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Hello!',
        apiKey: 'test-azure-api-key',
        azureEndpoint: 'https://my-azure-resource.openai.azure.com',
        azureApiVersion: '2024-07-01-preview',
        temperature: 0.7,
      }

      mockGetProviderFromModel.mockReturnValue('azure-openai')

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      expect(requestBody.azureEndpoint).toBe('https://my-azure-resource.openai.azure.com')
      expect(requestBody.azureApiVersion).toBe('2024-07-01-preview')
      expect(providerCall[0]).toBe('azure-openai')
      expect(requestBody.model).toBe('azure/gpt-4o')
      expect(requestBody.apiKey).toBe('test-azure-api-key')
    })

    it('should pass GPT-5 specific parameters (reasoningEffort and verbosity) through the request pipeline', async () => {
      const inputs = {
        model: 'gpt-5',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Hello!',
        apiKey: 'test-api-key',
        reasoningEffort: 'minimal',
        verbosity: 'high',
        temperature: 0.7,
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      expect(requestBody.reasoningEffort).toBe('minimal')
      expect(requestBody.verbosity).toBe('high')
      expect(providerCall[0]).toBe('openai')
      expect(requestBody.model).toBe('gpt-5')
      expect(requestBody.apiKey).toBe('test-api-key')
    })

    it('should handle missing GPT-5 parameters gracefully', async () => {
      const inputs = {
        model: 'gpt-5',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Hello!',
        apiKey: 'test-api-key',
        temperature: 0.7,
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()

      const providerCall = mockExecuteProviderRequest.mock.calls[0]
      const requestBody = providerCall[1]

      expect(requestBody.reasoningEffort).toBeUndefined()
      expect(requestBody.verbosity).toBeUndefined()
      expect(providerCall[0]).toBe('openai')
      expect(requestBody.model).toBe('gpt-5')
    })

    it('should handle MCP tools in agent execution', async () => {
      mockExecuteTool.mockImplementation((toolId, params, skipPostProcess, context) => {
        if (isMcpTool(toolId)) {
          return Promise.resolve({
            success: true,
            output: {
              content: [
                {
                  type: 'text',
                  text: `MCP tool ${toolId} executed with params: ${JSON.stringify(params)}`,
                },
              ],
            },
          })
        }
        return Promise.resolve({ success: false, error: 'Unknown tool' })
      })

      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'I will use MCP tools to help you.',
        model: 'gpt-4o',
        tokens: { input: 15, output: 25, total: 40 },
        toolCalls: [
          {
            name: 'mcp-server1-list_files',
            arguments: { path: '/tmp' },
            result: {
              success: true,
              output: { content: [{ type: 'text', text: 'Files listed' }] },
            },
          },
          {
            name: 'mcp-server2-search',
            arguments: { query: 'test', limit: 5 },
            result: {
              success: true,
              output: { content: [{ type: 'text', text: 'Search results' }] },
            },
          },
        ],
        timing: { total: 150 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'List files and search for test data',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'List Files',
            schema: {
              function: {
                name: 'mcp-server1-list_files',
                description: 'List files in directory',
                parameters: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'Directory path' },
                  },
                },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'mcp',
            title: 'Search',
            schema: {
              function: {
                name: 'mcp-server2-search',
                description: 'Search for data',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Search query' },
                    limit: { type: 'number', description: 'Result limit' },
                  },
                },
              },
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const mcpContext = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const result = await handler.execute(mcpContext, mockBlock, inputs)

      expect((result as any).content).toBe('I will use MCP tools to help you.')
      expect((result as any).toolCalls.count).toBe(2)
      expect((result as any).toolCalls.list).toHaveLength(2)

      expect((result as any).toolCalls.list[0].name).toBe('mcp-server1-list_files')
      expect((result as any).toolCalls.list[0].result.success).toBe(true)
      expect((result as any).toolCalls.list[1].name).toBe('mcp-server2-search')
      expect((result as any).toolCalls.list[1].result.success).toBe(true)
    })

    it('should handle MCP tool execution errors', async () => {
      mockExecuteTool.mockImplementation((toolId, params) => {
        if (toolId === 'mcp-server1-failing_tool') {
          return Promise.resolve({
            success: false,
            error: 'MCP server connection failed',
          })
        }
        return Promise.resolve({ success: false, error: 'Unknown tool' })
      })

      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Let me try to use this tool.',
        model: 'gpt-4o',
        tokens: { input: 10, output: 15, total: 25 },
        toolCalls: [
          {
            name: 'mcp-server1-failing_tool',
            arguments: { param: 'value' },
            result: {
              success: false,
              error: 'MCP server connection failed',
            },
          },
        ],
        timing: { total: 100 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Try to use the failing tool',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'Failing Tool',
            schema: {
              function: {
                name: 'mcp-server1-failing_tool',
                description: 'A tool that will fail',
                parameters: {
                  type: 'object',
                  properties: {
                    param: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const mcpContext = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const result = await handler.execute(mcpContext, mockBlock, inputs)

      expect((result as any).content).toBe('Let me try to use this tool.')
      expect((result as any).toolCalls.count).toBe(1)
      expect((result as any).toolCalls.list[0].result.success).toBe(false)
      expect((result as any).toolCalls.list[0].result.error).toBe('MCP server connection failed')
    })

    it('should transform MCP tools correctly for agent execution', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use MCP tools to help me',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'Read File',
            schema: {
              function: {
                name: 'mcp-filesystem-read_file',
                description: 'Read file from filesystem',
                parameters: { type: 'object', properties: {} },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'mcp',
            title: 'Web Search',
            schema: {
              function: {
                name: 'mcp-web-search',
                description: 'Search the web',
                parameters: { type: 'object', properties: {} },
              },
            },
            usageControl: 'force' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Used MCP tools successfully',
        model: 'gpt-4o',
        tokens: { input: 20, output: 30, total: 50 },
        toolCalls: [],
        timing: { total: 200 },
      })

      mockTransformBlockTool.mockImplementation((tool: { id?: string; operation?: string }) => ({
        id: tool.schema?.function?.name || `mcp-${tool.title.toLowerCase().replace(' ', '-')}`,
        name: tool.schema?.function?.name || tool.title,
        description: tool.schema?.function?.description || `MCP tool: ${tool.title}`,
        parameters: tool.schema?.function?.parameters || { type: 'object', properties: {} },
        usageControl: tool.usageControl,
      }))

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect(result).toBeDefined()
      expect(mockExecuteProviderRequest).toHaveBeenCalled()

      expect((result as any).content).toBe('Used MCP tools successfully')
      expect((result as any).model).toBe('gpt-4o')
    })

    it('should provide workspaceId context for MCP tool execution', async () => {
      let capturedContext: any
      mockExecuteTool.mockImplementation((toolId, params, skipPostProcess, context) => {
        capturedContext = context
        if (isMcpTool(toolId)) {
          return Promise.resolve({
            success: true,
            output: { content: [{ type: 'text', text: 'Success' }] },
          })
        }
        return Promise.resolve({ success: false, error: 'Unknown tool' })
      })

      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Using MCP tool',
        model: 'gpt-4o',
        tokens: { input: 10, output: 10, total: 20 },
        toolCalls: [{ name: 'mcp-test-tool', arguments: {} }],
        timing: { total: 50 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test MCP context',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'Test Tool',
            schema: {
              function: {
                name: 'mcp-test-tool',
                description: 'Test MCP tool',
                parameters: { type: 'object', properties: {} },
              },
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const contextWithWorkspace = {
        ...mockContext,
        workspaceId: 'test-workspace-456',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithWorkspace, mockBlock, inputs)

      expect(contextWithWorkspace.workspaceId).toBe('test-workspace-456')
    })

    it('should use cached schema for MCP tools (no discovery needed)', async () => {
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

      expect(mockDiscoverMcpServerToolsAsExecutor).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).toHaveBeenCalled()
    })

    it('should pass the cached tool schema to the provider', async () => {
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

    it('should pass callChain to executeProviderRequest for MCP cycle detection', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      )

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Search for files',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'search_files',
            schema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
              },
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

      const contextWithCallChain = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
        workflowId: 'test-workflow-456',
        callChain: ['wf-parent', 'test-workflow-456'],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithCallChain, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0][1]
      expect(providerCallArgs.callChain).toEqual(['wf-parent', 'test-workflow-456'])
    })

    it('should pass billingAttribution to executeProviderRequest so LLM tool calls carry it', async () => {
      const billingAttribution = {
        actorUserId: 'user-1',
        workspaceId: 'test-workspace-123',
        organizationId: 'organization-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'organization-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      }

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Search the knowledge base',
        apiKey: 'test-api-key',
      }

      const contextWithAttribution = {
        ...mockContext,
        workspaceId: 'test-workspace-123',
        workflowId: 'test-workflow-456',
        metadata: { ...mockContext.metadata, billingAttribution },
      } as ExecutionContext

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithAttribution, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0][1]
      expect(providerCallArgs.billingAttribution).toEqual(billingAttribution)
    })

    it('forwards streaming and agent events on opted-in runs', async () => {
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
        metadata: { ...mockContext.metadata, agentEvents: true },
      } as ExecutionContext

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(streamingContext, mockBlock, inputs)

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0][1]
      expect(providerCallArgs.stream).toBe(true)
      expect(providerCallArgs.agentEvents).toBe(true)
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

    it('should handle multiple MCP tools from the same server efficiently', async () => {
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Used tools',
        model: 'gpt-4o',
        tokens: { input: 10, output: 10, total: 20 },
        toolCalls: [],
        timing: { total: 50 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use all the tools',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'tool_1',
            schema: { type: 'object', properties: {} },
            params: {
              serverId: 'same-server',
              toolName: 'tool_1',
              serverName: 'server',
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'mcp',
            title: 'tool_2',
            schema: { type: 'object', properties: {} },
            params: {
              serverId: 'same-server',
              toolName: 'tool_2',
              serverName: 'server',
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'mcp',
            title: 'tool_3',
            schema: { type: 'object', properties: {} },
            params: {
              serverId: 'same-server',
              toolName: 'tool_3',
              serverName: 'server',
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

      expect(mockDiscoverMcpServerToolsAsExecutor).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).toHaveBeenCalled()
      const providerCallArgs = mockExecuteProviderRequest.mock.calls[0]
      expect(providerCallArgs[1].tools.length).toBe(3)
    })

    it('should discover MCP tools without cached schema through the application operation', async () => {
      mockDiscoverMcpServerToolsAsExecutor.mockResolvedValue([
        {
          name: 'legacy_tool',
          description: 'A legacy tool without cached schema',
          inputSchema: { type: 'object', properties: {} },
          serverName: 'legacy-server',
        },
      ])
      mockExecuteProviderRequest.mockResolvedValueOnce({
        content: 'Used legacy tool',
        model: 'gpt-4o',
        tokens: { input: 10, output: 10, total: 20 },
        toolCalls: [],
        timing: { total: 50 },
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the legacy tool',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'legacy_tool',
            params: {
              serverId: 'mcp-legacy-server',
              toolName: 'legacy_tool',
              serverName: 'legacy-server',
            },
            usageControl: 'auto' as const,
          },
        ],
      }

      const contextWithWorkspace = {
        ...mockContext,
        userId: 'user-1',
        workspaceId: 'test-workspace-123',
        workflowId: 'test-workflow-456',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(contextWithWorkspace, mockBlock, inputs)

      expect(mockDiscoverMcpServerToolsAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'test-workspace-123',
          context: expect.objectContaining({
            userId: contextWithWorkspace.userId,
            workflowId: 'test-workflow-456',
          }),
          serverId: 'mcp-legacy-server',
        })
      )
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/mcp/tools/discover'),
        expect.anything()
      )
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

      it('should fetch from DB when customToolId has no inline schema', async () => {
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
        expect(tools[0].parameters.required).toContain('format')
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

      it('settles a private selector when a later pre-provider tool build fails', async () => {
        const toolId = 'x'
        mockDBForCustomTool(toolId)
        const failure = new ToolSchemaEnrichmentError(
          'table_query_rows',
          new Error('table metadata unavailable')
        )
        mockTransformBlockTool.mockRejectedValueOnce(failure)
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
          userPrompt: 'Format and query a report',
          tools: [
            {
              type: 'custom-tool',
              customToolId: toolId,
              usageControl: 'auto' as const,
            },
            { type: 'table', operation: 'query_rows', usageControl: 'auto' as const },
          ],
        }

        await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toBe(failure)

        expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).toHaveBeenCalledWith(
          expect.objectContaining({ context: mockContext, identifier: toolId, lookup: 'id' })
        )
        expect(inputs.tools[0].customToolId).toBe('{{CANARY_CUSTOM_TOOL_ID}}')
        expect(mockContext.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
        expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
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

      it('should return null when DB fetch fails and no inline schema exists', async () => {
        mockDBFailure()

        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Format a report',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'custom-tool',
              customToolId: 'custom-tool-123',
              usageControl: 'auto' as const,
            },
          ],
        }

        mockGetProviderFromModel.mockReturnValue('openai')

        await handler.execute(mockContext, mockBlock, inputs)

        expect(mockExecuteProviderRequest).toHaveBeenCalled()
        const providerCall = mockExecuteProviderRequest.mock.calls[0]
        const tools = providerCall[1].tools

        expect(tools.length).toBe(0)
      })

      it('should use DB schema when customToolId resolves', async () => {
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
        expect(tools[0].id).toBe('custom_formatReport')
      })

      it('should not fetch from DB when no customToolId is present', async () => {
        const inputs = {
          model: 'gpt-4o',
          userPrompt: 'Use the tool',
          apiKey: 'test-api-key',
          tools: [
            {
              type: 'custom-tool',
              title: 'formatReport',
              schema: staleInlineSchema,
              code: staleInlineCode,
              usageControl: 'auto' as const,
            },
          ],
        }

        mockGetProviderFromModel.mockReturnValue('openai')

        await handler.execute(mockContext, mockBlock, inputs)

        expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).not.toHaveBeenCalled()

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

    it('retains useful ordinary tool diagnostics with a complete empty registry', async () => {
      vi.spyOn(handler as never, 'createCustomTool' as never).mockRejectedValueOnce(
        new Error('ordinary transform failure') as never
      )

      await privateHandler().formatTools(mockContext, [
        {
          type: 'custom-tool',
          title: 'Ordinary Tool',
          operation: 'lookup',
          schema: {},
          params: { toolName: 'lookup_item', serverId: 'server-1' },
        },
      ])

      expect(mockAgentLogger.error).toHaveBeenCalledWith(
        '[AgentHandler] Error creating tool',
        expect.objectContaining({
          toolType: 'custom-tool',
          title: 'Ordinary Tool',
          operation: 'lookup',
          toolName: 'lookup_item',
          serverId: 'server-1',
          errorMessage: 'ordinary transform failure',
          hasParams: true,
        })
      )
    })

    it('projects malformed model content and response format only in diagnostics', () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOKEN',
          plaintext: 'format-secret',
          encryptedValue: 'encrypted-format-secret',
        },
      ])
      registry.recordResolved('TOKEN', 'format-secret')
      const ctx = { ...mockContext, resolvedSecretTraceRegistry: registry }
      const content = 'not-json format-secret __var_TOKEN __sim_runtime_test_1'

      const result = privateHandler().processStructuredResponse(
        { content },
        { schema: 'format-secret', alias: '__var_TOKEN' },
        ctx
      )

      expect(result.content).toBe(content)
      const serializedCalls = JSON.stringify(mockAgentLogger.error.mock.calls)
      expect(serializedCalls).not.toContain('format-secret')
      expect(serializedCalls).not.toContain('__var_')
      expect(serializedCalls).not.toContain('__sim_')
      expect(mockAgentLogger.error).toHaveBeenCalledWith(
        'LLM did not adhere to structured response format',
        expect.objectContaining({
          content: 'not-json {{TOKEN}} {{TOKEN}} [RUNTIME_BINDING]',
          responseFormat: { schema: '{{TOKEN}}', alias: '{{TOKEN}}' },
        })
      )
    })
  })

  describe('wrapStreamForMemoryPersistence envelope', () => {
    it('preserves streamFormat and subscribe via object spread', () => {
      const handler = new AgentBlockHandler()
      const subscribe = vi.fn()
      const streamingExec: StreamingExecution = {
        stream: new ReadableStream(),
        streamFormat: 'agent-events-v1',
        subscribe,
        execution: {
          success: true,
          output: { content: '' },
          logs: [],
          metadata: { startTime: '', endTime: '', duration: 0 },
        },
      }

      const wrapped = (
        handler as unknown as {
          wrapStreamForMemoryPersistence: (
            ctx: ExecutionContext,
            inputs: Record<string, unknown>,
            exec: StreamingExecution
          ) => StreamingExecution
        }
      ).wrapStreamForMemoryPersistence({} as ExecutionContext, {}, streamingExec)

      expect(wrapped.streamFormat).toBe('agent-events-v1')
      expect(wrapped.subscribe).toBe(subscribe)
      expect(wrapped.stream).toBe(streamingExec.stream)
      expect(wrapped.execution).toBe(streamingExec.execution)
      expect(typeof wrapped.onFullContent).toBe('function')
    })
  })
})
