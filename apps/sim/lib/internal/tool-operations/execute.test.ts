/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function operationCall(input: unknown, signal?: AbortSignal): InternalToolOperationCall {
  return {
    toolId: 'example_operation',
    input,
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    ...(signal ? { signal } : {}),
  }
}

describe('executeToolOperationImplementation', () => {
  it.each([undefined, null, [], 'value'])(
    'rejects non-object semantic input before execution: %j',
    async (input) => {
      const operation = vi.fn()

      const response = await executeToolOperationImplementation(operation, operationCall(input))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: 'Invalid operation input',
      })
      expect(operation).not.toHaveBeenCalled()
    }
  )

  it('forwards semantic input, cancellation, and trusted context without HTTP metadata', async () => {
    const controller = new AbortController()
    const call = operationCall({ value: 42 }, controller.signal)
    const operation = vi.fn().mockResolvedValue({
      success: true,
      output: { value: 42 },
    })

    const response = await executeToolOperationImplementation(operation, call)

    expect(operation).toHaveBeenCalledWith({ value: 42 }, controller.signal, call.context)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { value: 42 },
    })
  })

  it('preserves a structured tool failure response', async () => {
    const response = await executeToolOperationImplementation(
      async () => ({
        success: false,
        output: { accepted: false },
        error: 'Provider rejected the operation',
        retryable: false,
      }),
      operationCall({ value: 42 })
    )

    await expect(response.json()).resolves.toEqual({
      success: false,
      output: { accepted: false },
      error: 'Provider rejected the operation',
      retryable: false,
    })
  })

  it('does not report cancellation after a mutation has committed', async () => {
    const controller = new AbortController()
    const response = await executeToolOperationImplementation(
      async () => {
        controller.abort(new Error('late cancellation'))
        return { success: true, output: { committed: true } }
      },
      operationCall({ value: 42 }, controller.signal)
    )

    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { committed: true },
    })
  })
})
