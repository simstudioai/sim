import { describe, expect, it } from 'vitest'
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
