import type {
  FirecrawlCancelCrawlParams,
  FirecrawlCancelCrawlResponse,
} from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const cancelCrawlTool: ToolConfig<FirecrawlCancelCrawlParams, FirecrawlCancelCrawlResponse> =
  {
    id: 'firecrawl_cancel_crawl',
    name: 'Firecrawl Cancel Crawl',
    description: 'Cancel an in-progress Firecrawl crawl job by its job ID.',
    version: '1.0.0',

    params: {
      jobId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the crawl job to cancel',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Firecrawl API key',
      },
    },

    request: {
      method: 'DELETE',
      url: (params) =>
        `https://api.firecrawl.dev/v2/crawl/${encodeURIComponent(params.jobId.trim())}`,
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          status: data.status ?? 'cancelled',
        },
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Status of the cancelled crawl job (e.g., "cancelled")',
      },
    },
  }
