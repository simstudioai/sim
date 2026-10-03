import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'

const mocks = vi.hoisted(() => ({
  executeImage: vi.fn(),
  executeText: vi.fn(),
}))

vi.mock('@/lib/internal/quiver/operations', () => ({
  executeQuiverImageToSvg: mocks.executeImage,
  executeQuiverTextToSvg: mocks.executeText,
}))

import { executeQuiverTool as executeQuiverToolOperation } from '@/lib/internal/quiver/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'quiver_text_to_svg',
    input: { apiKey: 'secret', model: 'arrow-preview', prompt: 'A compass' },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

async function executeQuiverTool(
  request: Parameters<typeof executeQuiverToolOperation>[0]
): Promise<Response> {
  const result = await executeQuiverToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

describe('executeQuiverTool', () => {
  beforeEach(() => {
    const result = {
      success: true,
      output: {
        file: { name: 'generated.svg' },
        files: [{ name: 'generated.svg' }],
        svgContent: '<svg />',
        id: 'generation-1',
        usage: null,
      },
    }
    mocks.executeText.mockResolvedValue(result)
    mocks.executeImage.mockResolvedValue(result)
  })

  it('preserves the route input byte ceiling', async () => {
    const response = await executeQuiverTool(
      request({
        input: {
          apiKey: 'secret',
          model: 'arrow-preview',
          prompt: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES),
        },
      })
    )

    expect(response.status).toBe(413)
    expect(mocks.executeText).not.toHaveBeenCalled()
  })
})
