/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecuteEnrichment = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/enrichment/operations', () => ({
  executeEnrichment: mockExecuteEnrichment,
}))

import { executeEnrichmentTool } from '@/lib/internal/enrichment/execute-tool'

describe('executeEnrichmentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteEnrichment.mockResolvedValue(Response.json({ matched: false }))
  })

  it('uses trusted workspace scope and preserves mapped model inputs', async () => {
    const traceRegistry = new Map()
    const response = await executeEnrichmentTool({
      toolId: 'enrichment_run',
      input: {
        enrichmentId: 'work-email',
        inputs: { company: '<block.company>', secret: '{{SECRET_NAME}}' },
        workspaceId: 'attacker-workspace',
      },
      headers: new Headers(),
      context: {
        userId: 'user-1',
        workspaceId: 'trusted-workspace',
        resolvedSecretTraceRegistry: traceRegistry,
      },
      requestId: 'request-1',
    } as never)

    expect(response.status).toBe(200)
    expect(mockExecuteEnrichment).toHaveBeenCalledWith(
      {
        enrichmentId: 'work-email',
        inputs: { company: '<block.company>', secret: '{{SECRET_NAME}}' },
      },
      expect.objectContaining({
        workspaceId: 'trusted-workspace',
        resolvedSecretTraceRegistry: traceRegistry,
      })
    )
  })

  it('rejects more than 100 mapped fields before running a provider', async () => {
    const inputs = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`f${index}`, index])
    )
    const response = await executeEnrichmentTool({
      toolId: 'enrichment_run',
      input: { enrichmentId: 'work-email', inputs },
      headers: new Headers(),
      context: { userId: 'user-1', workspaceId: 'workspace-1' },
      requestId: 'request-1',
    } as never)

    expect(response.status).toBe(400)
    expect(mockExecuteEnrichment).not.toHaveBeenCalled()
  })
})
