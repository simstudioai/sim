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
})
