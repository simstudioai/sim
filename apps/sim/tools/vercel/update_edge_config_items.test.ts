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

describe('vercel_update_edge_config_items empty body', () => {
  it('does not throw when the response carries no JSON body', async () => {
    const empty = {
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    } as unknown as Response

    const result = await vercelUpdateEdgeConfigItemsTool.transformResponse!(empty)
    expect(result.success).toBe(true)
    expect(result.output.status).toBe('')
  })
})
