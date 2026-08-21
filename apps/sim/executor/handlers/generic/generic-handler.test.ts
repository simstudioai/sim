import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { HarmonicBlock } from '@/blocks/blocks/harmonic'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { getBlock } from '@/blocks/index'
import { BlockType } from '@/executor/constants'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { selectKnowledgeDocumentWriteSecretProvenance } from '@/tools/knowledge/secret-provenance'
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

  it.concurrent('should always handle any block type', () => {
    const agentBlock: SerializedBlock = { ...mockBlock, metadata: { id: BlockType.AGENT } }
    expect(handler.canHandle(agentBlock)).toBe(true)
    expect(handler.canHandle(mockBlock)).toBe(true)
    const noMetaIdBlock: SerializedBlock = { ...mockBlock, metadata: undefined }
    expect(handler.canHandle(noMetaIdBlock)).toBe(true)
  })

  it.concurrent('should execute generic block by calling its associated tool', async () => {
    const inputs = { param1: 'resolvedValue1' }
    const expectedToolParams = {
      ...inputs,
      _context: { workflowId: mockContext.workflowId },
    }
    const expectedOutput: any = { customResult: 'OK' }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGetTool).toHaveBeenCalledWith('some_custom_tool')
    expect(mockExecuteTool).toHaveBeenCalledWith('some_custom_tool', expectedToolParams, {
      executionContext: mockContext,
    })
    expect(result).toEqual(expectedOutput)
  })

  it('preserves exact secret provenance when block params rename a selected input', async () => {
    mockTool.request.modelInput = {
      mode: 'private-provenance',
      inputPaths: () => [['filePath']],
    }
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) => ({
            filePath: String(params.document).trim(),
          }),
        },
      },
      inputs: {
        document: { type: 'string', description: 'Document URL' },
      },
    } as never)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'FILE_SECRET',
        plaintext: 'secret-url',
        encryptedValue: 'encrypted-file-secret',
      },
    ])
    registry.recordResolvedAtInputPath('FILE_SECRET', 'secret-url', ['document'])
    registry.recordResolvedInputProjection(['document'], '  secret-url  ', '  {{FILE_SECRET}}  ')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, { document: '  secret-url  ' })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({
        document: '  secret-url  ',
        filePath: 'secret-url',
      }),
      { executionContext: mockContext }
    )
    expect(registry.exportCommittedProvenanceForInputPaths([['filePath']])).toMatchObject({
      complete: true,
      entries: [{ name: 'FILE_SECRET', encryptedValue: 'encrypted-file-secret' }],
    })
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

  it('preserves exact table leaf provenance across legacy unquoted JSON placeholders', async () => {
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
    const registry = new ResolvedSecretTraceRegistry([
      { name: '1BOOLEAN_SECRET', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
      { name: 'UNUSED', plaintext: 'true', encryptedValue: 'encrypted-unused' },
    ])
    registry.recordResolvedAtInputPath('1BOOLEAN_SECRET', 'true', ['data'])
    registry.recordResolvedInputProjection(
      ['data'],
      '{"secret":true,"public":true}',
      '{"secret":{{1BOOLEAN_SECRET}},"public":true}'
    )
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, {
      data: '{"secret":true,"public":true}',
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({ data: { secret: true, public: true } }),
      { executionContext: mockContext }
    )
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'secret']])).toMatchObject({
      complete: true,
      entries: [{ name: '1BOOLEAN_SECRET', encryptedValue: 'encrypted-boolean' }],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'public']])).toMatchObject({
      complete: true,
      entries: [],
    })
  })

  it('normalizes legacy JSON-string knowledge tags without mutating inputs or overbinding tag names', async () => {
    mockTool.request.secretProvenance = {
      request: selectKnowledgeDocumentWriteSecretProvenance,
    }
    mockGetBlock.mockReturnValue(KnowledgeBlock)
    mockBlock.metadata = { id: 'knowledge', name: 'Knowledge' }
    const documentTags = '[{"tagName":"team","value":"support"}]'
    const projectedTags = '[{"tagName":"team","value":"{{TAG_VALUE}}"}]'
    const inputs = {
      operation: 'create_document',
      knowledgeBaseId: 'kb-1',
      name: 'doc.md',
      content: 'content',
      documentTags,
    }
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TAG_VALUE', plaintext: 'support', encryptedValue: 'encrypted-tag' },
    ])
    registry.recordResolvedAtInputPath('TAG_VALUE', 'support', ['documentTags'])
    registry.recordResolvedInputProjection(['documentTags'], documentTags, projectedTags)
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, inputs)

    expect(inputs.documentTags).toBe(documentTags)
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({
        documentTags: [{ tagName: 'team', value: 'support' }],
      }),
      { executionContext: mockContext }
    )
    expect(
      registry.exportCommittedProvenanceForInputPaths([['documentTags', '0', 'tagName']])
    ).toMatchObject({ complete: true, entries: [] })
    expect(
      registry.exportCommittedProvenanceForInputPaths([['documentTags', '0', 'value']])
    ).toMatchObject({
      complete: true,
      entries: [{ name: 'TAG_VALUE', encryptedValue: 'encrypted-tag' }],
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

  it('preserves structured message roles while projecting only model-visible content', async () => {
    const parseMessages = (value: unknown) => {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      if (!Array.isArray(parsed)) throw new Error('Messages must be an array')
      return parsed.map((message) => {
        if (
          !message ||
          typeof message !== 'object' ||
          !['user', 'assistant', 'system'].includes(String(message.role))
        ) {
          throw new Error('Invalid message role')
        }
        return { role: String(message.role), content: String(message.content) }
      })
    }
    mockTool.request.modelInput = {
      mode: 'project',
      select: (params) => ({
        messages: parseMessages(params.messages).map((message) => message.content),
      }),
      applyProjected: (selectedParams, projectedSelection) => ({
        messages: parseMessages(selectedParams.messages).map((message, index) => ({
          ...message,
          content: (projectedSelection.messages as unknown[])[index],
        })),
      }),
    }
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: {
          tool: () => 'some_custom_tool',
          params: (params: Record<string, unknown>) => ({
            messages: parseMessages(params.messages),
          }),
        },
      },
      inputs: {
        messages: { type: 'json', description: 'Messages' },
      },
    } as never)
    const rawMessages = '[{"role":"user","content":"hello"}]'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'MESSAGES', plaintext: rawMessages, encryptedValue: 'encrypted-messages' },
    ])
    registry.recordResolvedAtInputPath('MESSAGES', rawMessages, ['messages'])
    registry.recordResolvedInputProjection(['messages'], rawMessages, '{{MESSAGES}}')
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, { messages: rawMessages })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'some_custom_tool',
      expect.objectContaining({ messages: [{ role: 'user', content: 'hello' }] }),
      { executionContext: mockContext }
    )
    expect(
      registry.exportCommittedProvenanceForInputPaths([['messages', '0', 'role']])
    ).toMatchObject({ complete: true, entries: [] })
    expect(
      registry.exportCommittedProvenanceForInputPaths([['messages', '0', 'content']])
    ).toMatchObject({
      complete: true,
      entries: [{ name: 'MESSAGES', encryptedValue: 'encrypted-messages' }],
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

  it('does not replay block transforms for configured but unused secrets', async () => {
    mockTool.request.modelInput = {
      mode: 'project',
      select: (params) => ({ param1: params.param1 }),
    }
    const transform = vi.fn((params: Record<string, unknown>) => params)
    mockGetBlock.mockReturnValue({
      tools: {
        access: ['some_custom_tool'],
        config: { tool: () => 'some_custom_tool', params: transform },
      },
      inputs: {
        param1: { type: 'string', description: 'Value' },
      },
    } as never)
    mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'UNUSED', plaintext: 'value1', encryptedValue: 'encrypted-unused' },
    ])

    await handler.execute(mockContext, mockBlock, { param1: 'value1' })

    expect(transform).toHaveBeenCalledTimes(1)
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

  it('should throw error if the associated tool is not found', async () => {
    const inputs = { param1: 'value' }

    // Override mock to return undefined for this test
    mockGetTool.mockImplementation(() => undefined)

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Tool not found: some_custom_tool'
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should handle tool execution errors correctly', async () => {
    const inputs = { param1: 'value' }
    const errorResult = {
      success: false,
      error: 'Custom tool failed',
      output: { detail: 'error detail' },
    }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Custom tool failed'
    )

    // Re-execute to check error properties after catching
    try {
      await handler.execute(mockContext, mockBlock, inputs)
    } catch (e: any) {
      expect(e.toolId).toBe('some_custom_tool')
      expect(e.blockName).toBe('Test Generic Block')
      expect(e.output).toEqual({ detail: 'error detail' })
    }

    expect(mockExecuteTool).toHaveBeenCalledTimes(2) // Called twice now
  })

  it.concurrent('should handle tool execution errors with no specific message', async () => {
    const inputs = { param1: 'value' }
    const errorResult = { success: false, output: {} }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Block execution of Some Custom Tool failed with no error message'
    )
  })
})
