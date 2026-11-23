import { describe, expect, it } from 'vitest'
import { webflowDeleteItemTool } from '@/tools/webflow/delete_item'
import { webflowListItemsTool } from '@/tools/webflow/list_items'
import type { WebflowDeleteItemParams, WebflowListItemsParams } from '@/tools/webflow/types'

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

describe('Webflow item request URLs', () => {
  const base = { accessToken: 'token', collectionId: '580e63fc8c9a982ac9b8b745' }

  it('rejects an itemId that would traverse to another API path', () => {
    const url = webflowDeleteItemTool.request.url as (params: WebflowDeleteItemParams) => string
    expect(() => url({ ...base, itemId: '..' })).toThrow(/path traversal/)
    expect(() => url({ ...base, itemId: 'x/../../sites/abc' })).toThrow(/path separator/)
  })

  it('omits a non-numeric limit instead of sending NaN', () => {
    const url = webflowListItemsTool.request.url as (params: WebflowListItemsParams) => string
    expect(url({ ...base, limit: 'many' as unknown as number })).toBe(
      'https://api.webflow.com/v2/collections/580e63fc8c9a982ac9b8b745/items'
    )
  })
})
