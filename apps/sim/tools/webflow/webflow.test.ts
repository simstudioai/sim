/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { webflowListItemsTool } from '@/tools/webflow/list_items'

describe('Webflow tools', () => {
  it('reads list metadata from the documented pagination object', async () => {
    const items = [{ id: 'item-1', fieldData: { name: 'First item' } }]
    const response = new Response(
      JSON.stringify({ items, pagination: { offset: 200, limit: 100, total: 501 } }),
      { status: 200 }
    )

    await expect(webflowListItemsTool.transformResponse!(response, {} as never)).resolves.toEqual({
      success: true,
      output: {
        items,
        metadata: { itemCount: 1, offset: 200, limit: 100, total: 501 },
      },
    })
  })
})
