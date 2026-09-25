import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { HarmonicBlock } from '@/blocks/blocks/harmonic'
import { McpBlock } from '@/blocks/blocks/mcp'
import { getBlock } from '@/blocks/index'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { mcpRunOperationTool } from '@/tools/mcp/run-operation'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const mockGetBlock = vi.mocked(getBlock)
const mockGetTool = vi.mocked(getTool)
const mockExecuteTool = executeTool as Mock

describe('GenericBlockHandler', () => {
  let handler: GenericBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockTool: ToolConfig

  beforeEach(() => {
    handler = new GenericBlockHandler()

    mockBlock = {
      id: 'generic-block-1',
      metadata: { id: 'custom-type', name: 'Test Generic Block' },
      position: { x: 40, y: 40 },
      config: { tool: 'some_custom_tool', params: { param1: 'value1' } },
      inputs: { param1: 'string' }, // Using ParamType strings
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
    }

    mockTool = {
      id: 'some_custom_tool',
      name: 'Some Custom Tool',
      description: 'Does something custom',
      version: '1.0',
      params: { param1: { type: 'string' } },
      request: {
        url: 'https://example.com/api',
        method: 'POST',
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: (params) => params,
      },
    }

    // Reset mocks using vi
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(undefined)

    // Set up mockGetTool to return mockTool
    mockGetTool.mockImplementation((toolId) => {
      if (toolId === 'some_custom_tool') {
        return mockTool
      }
      return undefined
    })

    // Default mock implementations
    mockExecuteTool.mockResolvedValue({ success: true, output: { customResult: 'OK' } })
  })

  it('executes the standalone stable MCP action after argument resolution with trusted block scope', async () => {
    mockGetBlock.mockReturnValue(McpBlock)
    mockGetTool.mockReturnValue(mcpRunOperationTool)
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { content: [{ type: 'text', text: 'done' }] },
    })
    const block: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'mcp', name: 'MCP' },
      config: { tool: 'mcp_run_operation', params: {} },
    }
    const result = await handler.execute(mockContext, block, {
      server: 'canonical-server',
      connection: 'mcp-cg-123456789012345678901',
      tool: 'read',
      arguments: '{"limit":2}',
    })
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'mcp_run_operation',
      expect.objectContaining({
        server: 'canonical-server',
        connection: 'mcp-cg-123456789012345678901',
        tool: 'read',
        arguments: { limit: 2 },
      }),
      { executionContext: expect.objectContaining({ mcpBlockId: block.id }) }
    )
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] })
  })

  /**
   * `table_insert_row` posts row data to an internal API and declares no `modelInput` — nothing on
   * that path reaches a model, and its provenance travels in the private bundle. Marking its
   * `secretProvenance` roots as required-to-project made a projection failure fatal for a tool with
   * no way to project, and the Table block's `parseJSON` throws once a placeholder stands where the
   * JSON object was. The whole run's registry latched, costing provenance for every later boundary
   * including the table write that prompted it.
   */
  it('keeps vouching when a bundle-only tool cannot project and its block params throw', async () => {
    mockTool.request.secretProvenance = {
      request: () => [{ key: '0', inputPaths: [['data', 'apiKey']] }],
      response: { incomplete: 'propagate' },
    } as never
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) => {
            /**
             * Throws only on the projected copy. Real blocks reach this by validating or parsing a
             * field a placeholder now sits in — the Table block runs `parseJSON` over `data` — and
             * which shape breaks does not matter to the invariant under test.
             */
            if (typeof params.data === 'string' && params.data.includes('{{')) {
              throw new Error('cannot coerce a projected input')
            }
            return { data: params.data }
          },
        },
      },
      inputs: { data: { type: 'json', description: 'Row data' } },
    } as never)

    /** Valid JSON, so the block's first `params` call over the real inputs succeeds. */
    const rowJson = '{"apiKey":"x"}'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'ROW_SECRET', plaintext: rowJson, encryptedValue: 'encrypted-row-secret' },
    ])
    registry.recordResolvedAtInputPath('ROW_SECRET', rowJson, ['data'])
    registry.recordResolvedInputProjection(['data'], rowJson, '{{ROW_SECRET}}')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, { data: rowJson })

    expect(registry.isComplete()).toBe(true)
    expect(registry.getIncompletenessDiagnostics()).toBeUndefined()
  })

  it('traces each secret path without letting secret-valued controls change another path', async () => {
    mockTool.request.modelInput = {
      mode: 'private-provenance',
      inputPaths: () => [['input']],
    }
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) =>
            params.operation === 'deep_research' ? { input: params.research_input } : {},
        },
      },
      inputs: {
        operation: { type: 'string', description: 'Operation' },
        research_input: { type: 'string', description: 'Research input' },
      },
    } as never)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'OPERATION',
        plaintext: 'deep_research',
        encryptedValue: 'encrypted-operation',
      },
      { name: 'QUERY', plaintext: 'secret query', encryptedValue: 'encrypted-query' },
    ])
    registry.recordResolvedAtInputPath('OPERATION', 'deep_research', ['operation'])
    registry.recordResolvedInputProjection(['operation'], 'deep_research', '{{OPERATION}}')
    registry.recordResolvedAtInputPath('QUERY', 'secret query', ['research_input'])
    registry.recordResolvedInputProjection(['research_input'], 'secret query', '{{QUERY}}')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, {
      operation: 'deep_research',
      research_input: 'secret query',
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({
        operation: 'deep_research',
        research_input: 'secret query',
        input: 'secret query',
      }),
      { executionContext: mockContext }
    )
    expect(registry.exportCommittedProvenanceForInputPaths([['input']])).toMatchObject({
      complete: true,
      entries: [{ name: 'QUERY', encryptedValue: 'encrypted-query' }],
    })
  })

  it('preserves a whole structured secret without changing the raw parsed value', async () => {
    mockTool.request.secretProvenance = {
      request: () => [{ key: 'data', inputPaths: [['data']] }],
    }
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) => ({
            data: typeof params.data === 'string' ? JSON.parse(params.data) : params.data,
          }),
        },
      },
      inputs: {
        data: { type: 'json', description: 'Row data' },
      },
    } as never)
    const rawStructuredSecret = '{"nested":"value","url":"https://example.com/data","count":1}'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'JSON_SECRET',
        plaintext: rawStructuredSecret,
        encryptedValue: 'encrypted-json',
      },
    ])
    registry.recordResolvedAtInputPath('JSON_SECRET', rawStructuredSecret, ['data'])
    registry.recordResolvedInputProjection(['data'], rawStructuredSecret, '{{JSON_SECRET}}')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, { data: rawStructuredSecret })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({
        data: { nested: 'value', url: 'https://example.com/data', count: 1 },
      }),
      { executionContext: mockContext }
    )
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'nested']])).toMatchObject({
      complete: true,
      entries: [{ name: 'JSON_SECRET', encryptedValue: 'encrypted-json' }],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'count']])).toMatchObject({
      complete: true,
      entries: [{ name: 'JSON_SECRET', encryptedValue: 'encrypted-json' }],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'url']])).toMatchObject({
      complete: true,
      entries: [{ name: 'JSON_SECRET', encryptedValue: 'encrypted-json' }],
    })
  })

  it('preserves raw file execution while binding whole serialized descriptors to the file boundary', async () => {
    mockTool.params.audioFile = { type: 'file' }
    mockTool.params.audioUrl = { type: 'string' }
    mockTool.request.modelInput = {
      mode: 'private-provenance',
      inputPaths: () => [['audioUrl']],
    }
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) => {
            const file =
              typeof params.audioFile === 'string' ? JSON.parse(params.audioFile) : params.audioFile
            if (!file || typeof file !== 'object' || !String(file.url).startsWith('https://')) {
              throw new Error('A valid HTTPS audio file is required')
            }
            return { audioUrl: String(file.url), audioFile: undefined }
          },
        },
      },
      inputs: {
        audioFile: { type: 'json', description: 'Audio file' },
      },
    } as never)
    const rawFile = '{"name":"audio.mp3","size":4,"url":"https://files.example/audio.mp3"}'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FILE', plaintext: rawFile, encryptedValue: 'encrypted-file' },
    ])
    registry.recordResolvedAtInputPath('FILE', rawFile, ['audioFile'])
    registry.recordResolvedInputProjection(['audioFile'], rawFile, '{{FILE}}')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, { audioFile: rawFile })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({
        audioFile: undefined,
        audioUrl: 'https://files.example/audio.mp3',
      }),
      { executionContext: mockContext }
    )
    expect(registry.isComplete()).toBe(true)
    expect(registry.exportCommittedProvenanceForInputPaths([['audioUrl']])).toMatchObject({
      complete: true,
      entries: [{ name: 'FILE', encryptedValue: 'encrypted-file' }],
    })
  })

  it('does not expose an invalid resolved Harmonic batch value in handler errors', async () => {
    const resolvedSecret = 'sk-live-invalid-json-secret'
    mockBlock.metadata = { id: 'harmonic', name: 'Harmonic' }
    mockGetBlock.mockReturnValue(HarmonicBlock)
    mockExecuteTool.mockResolvedValue({
      success: false,
      error: 'Harmonic "personUrns" must be a JSON array',
    })

    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'BATCH_IDENTIFIERS',
        plaintext: resolvedSecret,
        encryptedValue: 'encrypted-batch-identifiers',
      },
    ])
    registry.recordResolvedAtInputPath('BATCH_IDENTIFIERS', resolvedSecret, ['personUrns'])
    registry.recordResolvedInputProjection(['personUrns'], resolvedSecret, '{{BATCH_IDENTIFIERS}}')
    mockContext.resolvedSecretTraceRegistry = registry

    let thrown: unknown
    try {
      await handler.execute(mockContext, mockBlock, {
        operation: 'harmonic_batch_get_people',
        oauthCredential: 'credential-id',
        personUrns: resolvedSecret,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('Harmonic "personUrns" must be a JSON array')
    expect((thrown as Error).message).not.toContain(resolvedSecret)
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({ personUrns: resolvedSecret }),
      { executionContext: mockContext }
    )
  })
})
