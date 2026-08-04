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
    const registryA = { id: 'a' }
    const registryB = { id: 'b' }

    await Promise.all([
      runWithProviderRuntimeContext(
        { resolvedSecretTraceRegistry: registryA as never },
        async () => {
          await Promise.resolve()
          await executeProviderTool('tool-a', { visible: 'a' })
        }
      ),
      runWithProviderRuntimeContext(
        { resolvedSecretTraceRegistry: registryB as never },
        async () => {
          await Promise.resolve()
          await executeProviderTool('tool-b', { visible: 'b' })
        }
      ),
    ])

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool-a',
      { visible: 'a' },
      { resolvedSecretTraceRegistry: registryA }
    )
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool-b',
      { visible: 'b' },
      { resolvedSecretTraceRegistry: registryB }
    )
  })

  it('preserves runtime context in a stream consumed after the provider call returns', async () => {
    const registry = { id: 'stream' }
    const stream = runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry as never },
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

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'stream-tool',
      { visible: true },
      { resolvedSecretTraceRegistry: registry }
    )
  })

  it('projects dormant catalog values without mutating the raw tool result', async () => {
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
      direct: '{{TOKEN}}',
      quoted: 'line\n"{{TOKEN}}"',
      alias: '{{TOKEN}}',
    })
    expect(rawResult.output.direct).toBe('secret-value')
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
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: 'secret-value' })

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
      mockExecuteTool.mockResolvedValueOnce({
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
    mockExecuteTool.mockResolvedValueOnce({
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

  it('fails a completed tool closed while a parallel sibling activation remains pending', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    let releaseSibling: (() => void) | undefined
    const siblingGate = new Promise<void>((resolve) => {
      releaseSibling = resolve
    })
    mockExecuteTool.mockImplementation(async (toolId: string) => {
      const finish = registry.beginPendingActivation()
      if (toolId === 'sibling') await siblingGate
      finish()
      return { success: true, output: { value: 'secret-value' } }
    })

    await runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registry }, async () => {
      const sibling = executeProviderTool('sibling', {})
      const completed = await executeProviderTool('completed', {})
      expect(completed.output).toEqual({})
      expect(JSON.stringify(completed)).not.toContain('secret-value')
      releaseSibling?.()
      expect((await sibling).output).toEqual({ value: '{{TOKEN}}' })
    })
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
    mockExecuteTool.mockRejectedValueOnce(new DOMException('secret-value', 'AbortError'))

    const error = await runWithProviderRuntimeContext(
      { resolvedSecretTraceRegistry: registry },
      () => executeProviderTool('custom-tool', {}).catch((caught) => caught)
    )

    expect(error).toBeInstanceOf(DOMException)
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('{{TOKEN}}')
  })
})
