/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operation = vi.hoisted(() => vi.fn())
vi.mock('@/lib/internal/extend/operations', () => ({ executeExtendParse: operation }))

import { executeExtendTool } from '@/lib/internal/extend/execute-tool'

describe('executeExtendTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operation.mockResolvedValue({ success: true, output: { id: 'parse-1' } })
  })

  it('dispatches both canonical IDs and rejects unsupported IDs', async () => {
    for (const toolId of ['extend_parser', 'extend_parser_v2']) {
      const response = await executeExtendTool({
        toolId,
        input: { apiKey: 'key', filePath: 'https://example.com/file.pdf' },
        headers: new Headers(),
        context: { ...createExecutionContext(), userId: 'user-1' },
        requestId: 'request-1',
      })
      expect(response.status).toBe(200)
    }
    const unsupported = await executeExtendTool({
      toolId: 'extend_unknown',
      input: {},
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
    })
    expect(unsupported.status).toBe(500)
  })
})
