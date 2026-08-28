/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operation = vi.hoisted(() => vi.fn())
vi.mock('@/lib/internal/reducto/operations', () => ({ executeReductoParse: operation }))

import { executeReductoTool } from '@/lib/internal/reducto/execute-tool'

describe('executeReductoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operation.mockResolvedValue({ success: true, output: { job_id: 'job-1' } })
  })

  it('dispatches both canonical IDs with trusted context', async () => {
    for (const toolId of ['reducto_parser', 'reducto_parser_v2']) {
      const controller = new AbortController()
      const response = await executeReductoTool({
        toolId,
        input: { apiKey: 'key', filePath: 'https://example.com/file.pdf' },
        headers: new Headers(),
        context: { ...createExecutionContext(), userId: 'user-1' },
        requestId: 'request-1',
        signal: controller.signal,
      })
      expect(response.status).toBe(200)
      expect(operation).toHaveBeenLastCalledWith(expect.any(Object), {
        headers: expect.any(Headers),
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      })
    }
  })
})
