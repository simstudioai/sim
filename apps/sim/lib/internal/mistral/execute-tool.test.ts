/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operation = vi.hoisted(() => vi.fn())
vi.mock('@/lib/internal/mistral/operations', () => ({ executeMistralParse: operation }))

import { executeMistralTool } from '@/lib/internal/mistral/execute-tool'

describe('executeMistralTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operation.mockResolvedValue({ success: true, output: { pages: [] } })
  })

  it('dispatches all canonical IDs and propagates cancellation', async () => {
    for (const toolId of ['mistral_parser', 'mistral_parser_v2', 'mistral_parser_v3']) {
      const response = await executeMistralTool({
        toolId,
        input: { apiKey: 'key', filePath: 'https://example.com/file.pdf' },
        headers: new Headers(),
        context: { ...createExecutionContext(), userId: 'user-1' },
        requestId: 'request-1',
      })
      expect(response.status).toBe(200)
    }

    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      executeMistralTool({
        toolId: 'mistral_parser',
        input: { apiKey: 'key', filePath: 'https://example.com/file.pdf' },
        headers: new Headers(),
        context: createExecutionContext(),
        requestId: 'request-1',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
