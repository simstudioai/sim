import type { FathomGetSummaryParams, FathomGetSummaryResponse } from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const getSummaryTool: ToolConfig<FathomGetSummaryParams, FathomGetSummaryResponse> = {
  id: 'fathom_get_summary',
  name: 'Fathom Get Summary',
  description: 'Get the call summary for a specific meeting recording.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fathom API Key',
    },
    recordingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The recording ID of the meeting',
    },
  },

  request: {
    url: (params) =>
      `https://api.fathom.ai/external/v1/recordings/${encodeURIComponent(params.recordingId.trim())}/summary`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Fathom API error: ${response.status} ${response.statusText}`,
        output: {
          template_name: null,
          markdown_formatted: null,
        },
      }
    }

    const data = await response.json()
    const summary = data.summary ?? data

    return {
      success: true,
      output: {
        template_name: summary.template_name ?? null,
        markdown_formatted: summary.markdown_formatted ?? null,
      },
    }
  },

  outputs: {
    template_name: {
      type: 'string',
      description: 'Name of the summary template used',
      optional: true,
    },
    markdown_formatted: {
      type: 'string',
      description: 'Markdown-formatted summary text',
      optional: true,
    },
  },
}
