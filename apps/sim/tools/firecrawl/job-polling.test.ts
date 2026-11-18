import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentTool } from '@/tools/firecrawl/agent'
import { crawlTool } from '@/tools/firecrawl/crawl'
import { extractTool } from '@/tools/firecrawl/extract'
import type { FirecrawlCrawlResponse } from '@/tools/firecrawl/types'

const fetchMock = vi.fn()
const started = (): FirecrawlCrawlResponse => ({
  success: true,
  output: { jobId: 'job-1', pages: [], total: 0 },
})
const params = { apiKey: 'fc-key', url: 'https://example.com' }
const executeTool = vi.fn()

function pollCrawl(signal?: AbortSignal) {
  if (!crawlTool.postProcess) throw new Error('crawlTool has no postProcess')
  return crawlTool.postProcess(started(), params, executeTool, { signal })
}

describe('Firecrawl crawl polling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  it('returns a completed crawl whose status body is over 10 MiB', async () => {
    const markdown = '文'.repeat(4 * 1024 * 1024)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'completed',
        total: 1,
        creditsUsed: 1,
        data: [{ markdown, metadata: { title: 'Page', sourceURL: 'https://example.com' } }],
      })
    )

    const result = await pollCrawl()

    expect(result.success).toBe(true)
    expect(result.output.pages[0].markdown).toHaveLength(markdown.length)
  })

  it('cancels the Firecrawl job when the workflow run is cancelled', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, status: 'cancelled' }))
    const controller = new AbortController()
    controller.abort()

    const result = await pollCrawl(controller.signal)

    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/crawl/job-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('fails at once instead of polling when Firecrawl returned no job ID', async () => {
    if (!crawlTool.postProcess) throw new Error('crawlTool has no postProcess')
    const result = await crawlTool.postProcess(
      { success: true, output: { pages: [], total: 0 } },
      params,
      executeTool
    )

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/job ID/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Firecrawl agent and extract job start', () => {
  it.each([
    ['agent', agentTool],
    ['extract', extractTool],
  ] as const)(
    '%s refuses a start response with no job id instead of polling it',
    async (_, tool) => {
      await expect(tool.transformResponse?.(jsonResponse({ success: true }))).rejects.toThrow(
        /did not return an? \w+ job id/
      )
      await expect(
        tool.transformResponse?.(jsonResponse({ success: false, error: 'Invalid schema' }))
      ).rejects.toThrow('Invalid schema')
    }
  )
})
