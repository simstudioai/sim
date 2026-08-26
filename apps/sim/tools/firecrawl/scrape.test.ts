/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { scrapeTool } from '@/tools/firecrawl/scrape'
import type { ScrapeParams } from '@/tools/firecrawl/types'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const scrapeParams: ScrapeParams = { apiKey: 'test-key', url: 'https://example.com' }

const resolveBody = (params: ScrapeParams): Record<string, unknown> =>
  scrapeTool.request.body!(params) as Record<string, unknown>

describe('firecrawl scrape error handling', () => {
  it('does not throw on a Firecrawl error body that carries no `data` key', async () => {
    const response = await scrapeTool.transformResponse!(
      json({ success: false, error: 'Request timed out' }, 408),
      scrapeParams
    )

    expect(response.output.markdown).toBeUndefined()
    expect(response.output.metadata).toBeUndefined()
  })

  it('still projects the document on a successful response', async () => {
    const response = await scrapeTool.transformResponse!(
      json(
        {
          success: true,
          data: {
            markdown: '# Hi',
            html: '<h1>Hi</h1>',
            metadata: { title: 'Hi', sourceURL: 'https://example.com', statusCode: 200 },
          },
          creditsUsed: 1,
        },
        200
      ),
      scrapeParams
    )

    expect(response.output.markdown).toBe('# Hi')
    expect(response.output.html).toBe('<h1>Hi</h1>')
    expect(response.output.metadata.title).toBe('Hi')
    expect(response.output.creditsUsed).toBe(1)
  })
})

describe('firecrawl scrape timeout is not the transport deadline', () => {
  it('does not declare the transport-reserved `timeout` param', () => {
    expect(scrapeTool.params.timeout).toBeUndefined()
    expect(scrapeTool.params.firecrawlTimeout).toBeDefined()
  })

  it('maps firecrawlTimeout onto the request body as Firecrawl `timeout`', () => {
    const body = resolveBody({ ...scrapeParams, firecrawlTimeout: 45000 })

    expect(body.timeout).toBe(45000)
  })
})
