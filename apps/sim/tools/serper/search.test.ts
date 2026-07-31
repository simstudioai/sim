/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/serper/search'

/**
 * `transformResponse` selects its result branch from the last path segment of `response.url`, which
 * `new Response()` leaves empty — hence the override.
 */
function serperResponse(url: string, body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('serper searchTool.transformResponse', () => {
  it('keeps the publication date Google reports on organic web results', async () => {
    const response = serperResponse('https://google.serper.dev/search', {
      organic: [
        {
          title: 'Release notes',
          link: 'https://example.com/notes',
          snippet: 'What changed',
          date: '2 days ago',
        },
      ],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toEqual([
      {
        title: 'Release notes',
        link: 'https://example.com/notes',
        snippet: 'What changed',
        position: 1,
        date: '2 days ago',
      },
    ])
  })

  it('leaves the date undefined when the result has none', async () => {
    const response = serperResponse('https://google.serper.dev/search', {
      organic: [{ title: 'Docs', link: 'https://example.com/docs', snippet: 'Reference' }],
    })

    const result = await searchTool.transformResponse!(response, {} as never)

    expect(result.output.searchResults[0].date).toBeUndefined()
  })
})
