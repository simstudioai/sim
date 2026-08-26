/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { vercelUpdateEdgeConfigItemsTool } from '@/tools/vercel/update_edge_config_items'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('vercel_update_edge_config_items', () => {
  it('returns the status Vercel actually reported', async () => {
    const result = await vercelUpdateEdgeConfigItemsTool.transformResponse!(
      jsonResponse({ status: 'processing' })
    )

    expect(result.success).toBe(true)
    expect(result.output.status).toBe('processing')
  })

  it('does not invent a status when the body omits it', async () => {
    const result = await vercelUpdateEdgeConfigItemsTool.transformResponse!(jsonResponse({}))

    expect(result.output.status).toBe('')
  })
})
