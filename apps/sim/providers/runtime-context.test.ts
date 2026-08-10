/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(async () => ({ success: true, output: {} })),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  type ExecuteProviderToolOptions,
  executeProviderTool as executeProviderToolWithInput,
  runWithProviderRuntimeContext,
} from '@/providers/runtime-context'
import { registerProviderToolInputProvenance } from '@/providers/tool-input-provenance'
import { prepareToolExecution } from '@/providers/utils'

async function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeProviderToolWithInput>[1],
  options: ExecuteProviderToolOptions = {}
) {
  const execution = await executeProviderToolWithInput(toolId, params, options)
  return execution.modelResponse
}

describe('provider runtime context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isolates concurrent tool executions without adding registry data to params', async () => {
    const registryA = new ResolvedSecretTraceRegistry()
    const registryB = new ResolvedSecretTraceRegistry()

    await Promise.all([
      runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registryA }, async () => {
        await Promise.resolve()
        await executeProviderTool('tool-a', { visible: 'a' })
      }),
      runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registryB }, async () => {
        await Promise.resolve()
        await executeProviderTool('tool-b', { visible: 'b' })
      }),
    ])

    const toolACall = mockExecuteTool.mock.calls.find(([toolId]) => toolId === 'tool-a')
    const toolBCall = mockExecuteTool.mock.calls.find(([toolId]) => toolId === 'tool-b')
    const toolARegistry = toolACall?.[2]?.resolvedSecretTraceRegistry
    const toolBRegistry = toolBCall?.[2]?.resolvedSecretTraceRegistry

    expect(toolACall?.[1]).toEqual({ visible: 'a' })
    expect(toolBCall?.[1]).toEqual({ visible: 'b' })
    expect(toolARegistry).toBeInstanceOf(ResolvedSecretTraceRegistry)
    expect(toolBRegistry).toBeInstanceOf(ResolvedSecretTraceRegistry)
    expect(toolARegistry).not.toBe(registryA)
    expect(toolBRegistry).not.toBe(registryB)
    expect(toolARegistry).not.toBe(toolBRegistry)
  })

  it('preserves runtime context in a stream consumed after the provider call returns', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const stream = runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () =>
        new ReadableStream({
          async pull(controller) {
            await executeProviderTool('stream-tool', { visible: true })
            controller.enqueue(new TextEncoder().encode('done'))
            controller.close()
          },
        })
    )

    await new Response(stream).text()

    const toolCall = mockExecuteTool.mock.calls.find(([toolId]) => toolId === 'stream-tool')
    expect(toolCall?.[1]).toEqual({ visible: true })
    expect(toolCall?.[2]?.resolvedSecretTraceRegistry).toBeInstanceOf(ResolvedSecretTraceRegistry)
    expect(toolCall?.[2]?.resolvedSecretTraceRegistry).not.toBe(registry)
  })

  it('does not treat an arbitrary tool-result collision as secret provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const rawResult = {
      success: true,
      output: { direct: 'secret-value', quoted: 'line\n"secret-value"', alias: '__var_TOKEN' },
    }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result.output).toEqual({
      direct: 'secret-value',
      quoted: 'line\n"secret-value"',
      alias: '__var_TOKEN',
    })
    expect(rawResult.output.direct).toBe('secret-value')
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('does not seed provenance from ambient execution context', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TEXT', plaintext: 'Test', encryptedValue: 'encrypted-text' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'encrypted-boolean' },
      { name: 'NUMBER', plaintext: '123', encryptedValue: 'encrypted-number' },
    ])
    registry.recordResolved('TEXT', 'Test')
    registry.recordResolved('BOOLEAN', 'true')
    registry.recordResolved('NUMBER', '123')
    const rawResult = {
      success: true,
      output: { text: 'Test', boolean: true, booleanText: 'true', number: 123, numberText: '123' },
    }
    mockExecuteTool.mockResolvedValueOnce(rawResult)
    const { executionParams } = prepareToolExecution(
      { params: { visible: 'unrelated' } },
      {},
      {
        environmentVariables: { TEXT: 'Test' },
        workflowVariables: { boolean: true },
        blockData: { number: 123 },
        blockNameMapping: { Test: 'block-id' },
      }
    )

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', executionParams)
    )

    expect(result).toEqual(rawResult)
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'custom-tool',
      expect.objectContaining({
        envVars: { TEXT: 'Test' },
        workflowVariables: { boolean: true },
        blockData: { number: 123 },
        blockNameMapping: { Test: 'block-id' },
      }),
      expect.any(Object)
    )
    expect(mockExecuteTool.mock.calls[0]?.[2]).not.toHaveProperty('toolInput')
    expect(registry.isComplete()).toBe(true)
  })

  it('does not treat a static tool parameter name as secret-bearing input', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PARAM_NAME', plaintext: 'prompt', encryptedValue: 'encrypted-param-name' },
    ])
    registry.recordResolved('PARAM_NAME', 'prompt')
    const rawResult = { success: true, output: { value: 'prompt' } }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', { prompt: 'unrelated' })
    )

    expect(result).toEqual(rawResult)
    expect(registry.isComplete()).toBe(true)
  })

  it('does not infer output provenance from a secret in the current tool input', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')
    const rawResult = {
      success: true,
      output: { authorization: 'Bearer secret-value' },
      statusCode: 206,
      timing: { startTime: 'start', endTime: 'end', duration: 5 },
      largeValueKeys: ['large-key'],
      fileKeys: ['file-key'],
      resources: [{ type: 'file' as const, id: 'file-1', title: 'Raw resource' }],
    }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () =>
        executeProviderToolWithInput('custom-tool', {
          token: 'secret-value',
          envVars: { unrelated: 'public' },
        })
    )

    expect(execution.rawResponse).toBe(rawResult)
    expect(execution.rawResponse.output).toEqual({ authorization: 'Bearer secret-value' })
    expect(execution.modelResponse).toEqual(rawResult)
    expect(execution.modelResponse.resources).toBe(rawResult.resources)
    expect(registry.isComplete()).toBe(true)
  })

  it('projects only the active preset secret for the exact configured tool instance', async () => {
    const sourceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'ACTIVE', plaintext: 'x', encryptedValue: 'encrypted-active' },
      { name: 'UNUSED', plaintext: 'true', encryptedValue: 'encrypted-unused' },
    ])
    const sourcePath = ['tools', '0', 'params', 'apiKey'] as const
    sourceRegistry.recordResolvedAtInputPath('ACTIVE', 'x', sourcePath)
    sourceRegistry.recordResolvedInputProjection(sourcePath, 'x', '{{ACTIVE}}')
    const runtimeRegistry = sourceRegistry.forkForInputPaths([])
    const tool = {
      id: 'duplicate-tool',
      params: { apiKey: 'x' },
      parameters: { type: 'object', properties: {}, required: [] },
      paramsTransform: (params: Record<string, unknown>) => ({ token: params.apiKey }),
    }
    registerProviderToolInputProvenance(tool, {
      registry: sourceRegistry,
      sourcePath: ['tools', '0', 'params'],
      projectedParams: { apiKey: '{{ACTIVE}}' },
    })
    const rawResult = { success: true, output: { reflected: 'x', ordinary: 'true' } }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: runtimeRegistry },
      () => {
        const { executionParams } = prepareToolExecution(tool, {}, {})
        return executeProviderToolWithInput(tool.id, executionParams)
      }
    )

    expect(execution.rawResponse).toBe(rawResult)
    expect(execution.modelResponse.output).toEqual({
      reflected: '{{ACTIVE}}',
      ordinary: 'true',
    })
    expect(mockExecuteTool.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ token: 'x' }))
    expect(mockExecuteTool.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      '__resolvedSecretTraceProvenance'
    )
    expect(runtimeRegistry.getActiveMatches()).toEqual([
      { plaintext: 'x', replacement: '{{ACTIVE}}' },
    ])
  })

  it('does not carry a prior low-entropy preset into a later duplicate tool instance', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'x', encryptedValue: 'encrypted-first' },
    ])
    const firstPath = ['tools', '0', 'params', 'apiKey'] as const
    registry.recordResolvedAtInputPath('FIRST', 'x', firstPath)
    registry.recordResolvedInputProjection(firstPath, 'x', '{{FIRST}}')
    const firstTool = {
      id: 'duplicate-tool',
      params: { apiKey: 'x' },
      parameters: { type: 'object', properties: {}, required: [] },
    }
    const secondTool = {
      id: 'duplicate-tool',
      params: { query: 'safe' },
      parameters: { type: 'object', properties: {}, required: [] },
    }
    registerProviderToolInputProvenance(firstTool, {
      registry,
      sourcePath: ['tools', '0', 'params'],
      projectedParams: { apiKey: '{{FIRST}}' },
    })
    registerProviderToolInputProvenance(secondTool, {
      registry,
      sourcePath: ['tools', '1', 'params'],
      projectedParams: { query: 'safe' },
    })
    mockExecuteTool
      .mockResolvedValueOnce({ success: true, output: { value: 'x' } })
      .mockResolvedValueOnce({ success: true, output: { value: 'Box' } })

    const executions = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      async () => {
        const firstParams = prepareToolExecution(firstTool, {}, {}).executionParams
        const first = await executeProviderToolWithInput(firstTool.id, firstParams)
        const secondParams = prepareToolExecution(secondTool, {}, {}).executionParams
        const second = await executeProviderToolWithInput(secondTool.id, secondParams)
        return { first, second }
      }
    )

    expect(executions.first.modelResponse.output).toEqual({ value: '{{FIRST}}' })
    expect(executions.second.rawResponse.output).toEqual({ value: 'Box' })
    expect(executions.second.modelResponse.output).toEqual({ value: 'Box' })
  })

  it('does not activate a configured preset that the deterministic transform drops', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'DROPPED', plaintext: 'x', encryptedValue: 'encrypted-dropped' },
    ])
    const sourcePath = ['tools', '0', 'params', 'inactive'] as const
    registry.recordResolvedAtInputPath('DROPPED', 'x', sourcePath)
    registry.recordResolvedInputProjection(sourcePath, 'x', '{{DROPPED}}')
    const tool = {
      id: 'conditional-tool',
      params: { inactive: 'x', query: 'safe' },
      parameters: { type: 'object', properties: {}, required: [] },
      paramsTransform: (params: Record<string, unknown>) => ({ query: params.query }),
    }
    registerProviderToolInputProvenance(tool, {
      registry,
      sourcePath: ['tools', '0', 'params'],
      projectedParams: { inactive: '{{DROPPED}}', query: 'safe' },
    })
    const rawResult = { success: true, output: { value: 'Box' } }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => {
        const { executionParams } = prepareToolExecution(tool, {}, {})
        return executeProviderToolWithInput(tool.id, executionParams)
      }
    )

    expect(mockExecuteTool.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ query: 'safe' })
    )
    expect(mockExecuteTool.mock.calls.at(-1)?.[1]).not.toHaveProperty('inactive')
    expect(execution.rawResponse).toBe(rawResult)
    expect(execution.modelResponse.output).toEqual({ value: 'Box' })
  })

  it('serializes dates for provider continuations while preserving the raw tool response', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const createdAt = new Date('2026-08-05T12:34:56.789Z')
    const rawResult = {
      success: true,
      output: { id: 'row-1', createdAt },
    }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderToolWithInput('custom-tool', {})
    )

    expect(execution.rawResponse).toBe(rawResult)
    expect(execution.rawResponse.output.createdAt).toBe(createdAt)
    expect(execution.modelResponse).toEqual({
      success: true,
      output: { id: 'row-1', createdAt: '2026-08-05T12:34:56.789Z' },
    })
  })

  it.each([
    ['string', 'safe text', 'safe text'],
    ['number', 0, 0],
    ['boolean', false, false],
    ['null', null, null],
  ])(
    'preserves safe primitive %s tool output for provider continuations',
    async (_, output, expected) => {
      const registry = new ResolvedSecretTraceRegistry()
      mockExecuteTool.mockResolvedValueOnce({ success: true, output })

      const result = await runWithProviderRuntimeContext(
        { resolvedSecretTraceRegistry: registry },
        () => executeProviderTool('custom-tool', {})
      )

      expect(result.output).toBe(expected)
    }
  )

  it('projects a primitive secret-bearing tool output for provider continuations', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value', {
        propagated: true,
      })
      return { success: true, output: 'secret-value' }
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result.output).toBe('{{TOKEN}}')
  })

  it.each(['123'])(
    'leaves non-model resource metadata untouched while projecting content (%s)',
    async (secret) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
        options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', secret, { propagated: true })
        return {
          success: true,
          output: {
            value: `Result ${secret}`,
            converted: secret === '123' ? 123 : true,
          },
          resources: [
            {
              type: 'file',
              id: secret,
              title: `Report ${secret}`,
              path: `files/${secret}.txt`,
            },
          ],
        }
      })

      const result = await runWithProviderRuntimeContext(
        { resolvedSecretTraceRegistry: registry },
        () => executeProviderTool('custom-tool', {})
      )

      expect(result.output).toEqual({
        value: 'Result {{TOKEN}}',
        converted: '{{TOKEN}}',
      })
      expect(result.resources).toEqual([
        {
          type: 'file',
          id: secret,
          title: `Report ${secret}`,
          path: `files/${secret}.txt`,
        },
      ])
    }
  )

  it('does not project resource metadata that is not serialized into the model continuation', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value')
      return {
        success: true,
        output: {},
        resources: [
          {
            type: 'file',
            id: 'safe-file',
            title: 'secret-value report',
            path: '/workspace/safe/report.txt',
          },
          {
            type: 'file',
            id: 'unsafe-file',
            title: 'report.txt',
            path: '/workspace/secret-value/report.txt',
          },
        ],
      }
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result.resources).toEqual([
      {
        type: 'file',
        id: 'safe-file',
        title: 'secret-value report',
        path: '/workspace/safe/report.txt',
      },
      {
        type: 'file',
        id: 'unsafe-file',
        title: 'report.txt',
        path: '/workspace/secret-value/report.txt',
      },
    ])
  })

  it('projects and merges a completed tool while a parallel sibling activation remains pending', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'COMPLETED', plaintext: 'completed-secret', encryptedValue: 'completed-ciphertext' },
      { name: 'SIBLING', plaintext: 'sibling-secret', encryptedValue: 'sibling-ciphertext' },
    ])
    let releaseSibling: (() => void) | undefined
    const siblingGate = new Promise<void>((resolve) => {
      releaseSibling = resolve
    })
    mockExecuteTool.mockImplementation(async (toolId: string, _params, options) => {
      const toolCallRegistry = options.resolvedSecretTraceRegistry
      if (!toolCallRegistry) throw new Error('Missing tool-call registry')
      const finish = toolCallRegistry.beginPendingActivation()
      if (toolId === 'sibling') await siblingGate
      const name = toolId === 'sibling' ? 'SIBLING' : 'COMPLETED'
      const plaintext = toolId === 'sibling' ? 'sibling-secret' : 'completed-secret'
      toolCallRegistry.recordResolved(name, plaintext, { propagated: true })
      finish()
      return { success: true, output: { value: plaintext } }
    })

    await runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registry }, async () => {
      const sibling = executeProviderTool('sibling', {})
      const completed = await executeProviderTool('completed', {})
      expect(completed.output).toEqual({ value: '{{COMPLETED}}' })
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'completed-secret', replacement: '{{COMPLETED}}' },
      ])
      releaseSibling?.()
      expect((await sibling).output).toEqual({ value: '{{SIBLING}}' })
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'completed-secret', replacement: '{{COMPLETED}}' },
        { plaintext: 'sibling-secret', replacement: '{{SIBLING}}' },
      ])
    })
  })

  it('omits an incomplete model result and marks parent provenance incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.markIncomplete()
      return { success: true, output: { value: 'secret-value' } }
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result).toEqual({ success: true, output: {} })
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('structurally omits an incomplete failed model result and marks provenance incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.markIncomplete()
      return {
        success: false,
        output: { value: 'secret-value' },
        error: 'secret-value',
      }
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result).toEqual({
      success: false,
      output: {},
      error:
        'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.',
    })
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('retains child provenance for raw traces when model projection fails', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      const toolCallRegistry = options.resolvedSecretTraceRegistry
      if (!toolCallRegistry) throw new Error('Missing tool-call registry')
      toolCallRegistry.recordResolved('TOKEN', 'secret-value')
      const output: Record<string, unknown> = { value: 'secret-value' }
      output.self = output
      return { success: true, output }
    })

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderToolWithInput('custom-tool', {})
    )

    expect(execution.rawResponse.output).toHaveProperty('value', 'secret-value')
    expect(execution.modelResponse).toEqual({ success: true, output: {} })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
    ])
  })

  it('keeps a raw thrown error separate from the omitted model error', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.markIncomplete()
      throw new Error('secret-value')
    })

    const execution = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderToolWithInput('custom-tool', {})
    )

    expect(execution.rawResponse).toEqual({
      success: false,
      output: {},
      error: 'secret-value',
    })
    expect(execution.modelResponse).toEqual({
      success: false,
      output: {},
      error:
        'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.',
    })
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('fails closed for an incomplete registry', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.markIncomplete()
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: { value: 'secret-value' },
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result).toMatchObject({ success: true, output: {} })
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('keeps non-workflow provider tool calls raw when no projection context exists', async () => {
    const rawResult = { success: true, output: { value: 'raw-value' } }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    await expect(executeProviderTool('standalone-tool', {})).resolves.toBe(rawResult)
  })

  it('clears an inherited workflow context for an explicitly context-free provider call', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const rawResult = { success: true, output: { value: 'secret-value' } }
    mockExecuteTool.mockResolvedValueOnce(rawResult)

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () =>
        runWithProviderRuntimeContext(undefined, () => executeProviderTool('standalone-tool', {}))
    )

    expect(result).toBe(rawResult)
  })

  it('preserves raw abort semantics without creating a model continuation', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value')
      throw new DOMException('secret-value', 'AbortError')
    })

    const error = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {}).catch((caught) => caught)
    )

    expect(error).toBeInstanceOf(DOMException)
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('secret-value')
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
    ])
  })
})
