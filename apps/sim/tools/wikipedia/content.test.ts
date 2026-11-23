import { describe, expect, it } from 'vitest'
import { pageContentTool } from '@/tools/wikipedia/content'

describe('wikipedia pageContentTool.transformResponse', () => {
  it('reads the revision from the weak ETag Wikipedia sends and keeps the requested title', async () => {
    const response = new Response('<html></html>', {
      headers: { etag: 'W/"1386275911/8a8c578c-e2e6-11f1-a86d-f555990d2ea4/view"' },
    })

    const result = await pageContentTool.transformResponse?.(response, {
      pageTitle: 'Albert Einstein',
    })

    expect(result?.output.content.revision).toBe(1386275911)
    expect(result?.output.content.title).toBe('Albert Einstein')
  })
})
