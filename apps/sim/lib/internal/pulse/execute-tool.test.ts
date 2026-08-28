/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operation = vi.hoisted(() => vi.fn())
vi.mock('@/lib/internal/pulse/operations', () => ({ executePulseParse: operation }))

import { executePulseTool } from '@/lib/internal/pulse/execute-tool'

describe('executePulseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operation.mockResolvedValue({ success: true, output: { job_id: 'job-1' } })
  })

  it('dispatches both canonical IDs with trusted context', async () => {
    for (const toolId of ['pulse_parser', 'pulse_parser_v2']) {
      const response = await executePulseTool({
        toolId,
        input: { apiKey: 'key', filePath: 'https://example.com/file.pdf' },
        headers: new Headers(),
        context: { ...createExecutionContext(), userId: 'user-1' },
        requestId: 'request-1',
      })
      expect(response.status).toBe(200)
    }
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
