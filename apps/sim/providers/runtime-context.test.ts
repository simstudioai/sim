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
import { executeProviderTool, runWithProviderRuntimeContext } from '@/providers/runtime-context'

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

  it('preserves public low-entropy output that is unrelated to the current tool input', async () => {
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

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', { visible: 'unrelated' })
    )

    expect(result).toEqual(rawResult)
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

  it('projects a secret inherited through the exact current tool input', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: { authorization: 'Bearer secret-value' },
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', { token: 'secret-value' })
    )

    expect(result.output).toEqual({ authorization: 'Bearer {{TOKEN}}' })
    expect(registry.isComplete()).toBe(true)
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
      options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', 'secret-value')
      return { success: true, output: 'secret-value' }
    })

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result.output).toBe('{{TOKEN}}')
  })

  it.each(['123', 'true'])(
    'omits secret-bearing resource controls while projecting low-entropy content (%s)',
    async (secret) => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
      ])
      mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
        options.resolvedSecretTraceRegistry?.recordResolved('TOKEN', secret)
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
      expect(result.resources).toEqual([])
    }
  )

  it('preserves safe resource paths and omits resources with secret-bearing paths', async () => {
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
        title: '{{TOKEN}} report',
        path: '/workspace/safe/report.txt',
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
      toolCallRegistry.recordResolved(name, plaintext)
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

  it('omits an incomplete tool result without poisoning the parent registry', async () => {
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
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('structurally omits an incomplete failed tool result without poisoning the parent registry', async () => {
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

    expect(result).toEqual({ success: false, output: {} })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('discards child provenance when response projection fails', async () => {
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

    const result = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {})
    )

    expect(result).toEqual({ success: true, output: {} })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('omits an incomplete tool error without poisoning the parent registry', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    mockExecuteTool.mockImplementationOnce(async (_toolId, _params, options) => {
      options.resolvedSecretTraceRegistry?.markIncomplete()
      throw new Error('secret-value')
    })

    const error = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {}).catch((caught) => caught)
    )

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('')
    expect(registry.isComplete()).toBe(true)
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

  it('sanitizes thrown errors while preserving abort semantics', async () => {
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
    expect(error.message).toBe('{{TOKEN}}')
  })
})
