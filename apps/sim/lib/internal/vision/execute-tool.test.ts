import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'

const executeVisionOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/vision/operations', () => ({ executeVisionOperation }))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { executeVisionTool } from '@/lib/internal/vision/execute-tool'

function toolRequest(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'vision_tool',
    input: {
      apiKey: 'secret',
      imageUrl: 'https://images.example.com/a.png',
      imageFile: null,
      model: 'gpt-5.2',
      prompt: null,
    },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

describe('executeVisionTool', () => {
  beforeEach(() => {
    executeVisionOperation.mockResolvedValue({ content: 'A lighthouse', model: 'gpt-5.2' })
  })

  it('preserves the route input byte ceiling', async () => {
    const response = await executeVisionTool(
      toolRequest({ input: { apiKey: 'secret', prompt: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES) } })
    )

    expect(response.status).toBe(413)
    expect(executeVisionOperation).not.toHaveBeenCalled()
  })
})
