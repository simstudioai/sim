import type {
  FirecrawlExtractStatusParams,
  FirecrawlExtractStatusResponse,
} from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const extractStatusTool: ToolConfig<
  FirecrawlExtractStatusParams,
  FirecrawlExtractStatusResponse
> = {
  id: 'firecrawl_extract_status',
  name: 'Firecrawl Extract Status',
  description:
    'Check the status and retrieve results of a previously started Firecrawl extract job by its job ID.',
  version: '1.0.0',

  params: {
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the extract job to check',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'GET',
    url: (params) =>
      `https://api.firecrawl.dev/v2/extract/${encodeURIComponent(params.jobId.trim())}`,
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
        status: data.status,
        data: data.data ?? {},
        expiresAt: data.expiresAt ?? null,
        sources: data.sources ?? null,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Current extract status (processing, completed, failed, or cancelled)',
    },
    data: {
      type: 'object',
      description: 'Extracted structured data according to the schema or prompt',
    },
    expiresAt: {
      type: 'string',
      description: 'ISO timestamp when the extract results expire',
      optional: true,
    },
    sources: {
      type: 'json',
      description: 'Source URLs for the extracted data (when showSources was enabled)',
      optional: true,
    },
  },
}
