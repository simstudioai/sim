import type {
  ChartQueryCreateChartFromPromptParams,
  ChartQueryShareResponse,
} from '@/tools/chartquery/types'
import { CHARTQUERY_SHARE_OUTPUTS } from '@/tools/chartquery/types'
import {
  CHARTQUERY_API_BASE,
  chartQueryBody,
  chartQueryHeaders,
  mapChartQueryShare,
} from '@/tools/chartquery/utils'
import type { ToolConfig } from '@/tools/types'

export const chartQueryCreateChartFromPromptTool: ToolConfig<
  ChartQueryCreateChartFromPromptParams,
  ChartQueryShareResponse
> = {
  id: 'chartquery_create_chart_from_prompt',
  name: 'ChartQuery Create Chart From Prompt',
  description:
    'Describe a chart in plain language, optionally with raw CSV or JSON data, and get public links to the image ChartQuery builds from it.',
  version: '1.0.0',

  params: {
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'What to chart, 5 to 1000 characters: chart type, data, labels (e.g., "Bar chart of Q1 revenue: Jan 12, Feb 15, Mar 9")',
    },
    rawData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data to chart as CSV or JSON text (e.g., "month,revenue\\nJan,12\\nFeb,15")',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Chart title, replacing the one ChartQuery would generate',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image format: png (default) or svg',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image width in pixels, 50 to 4000 (default 1200)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image height in pixels, 50 to 4000 (default 600)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ChartQuery API key',
    },
  },

  request: {
    url: `${CHARTQUERY_API_BASE}/chart/ai`,
    method: 'POST',
    headers: (params) => chartQueryHeaders(params.apiKey),
    body: (params) =>
      chartQueryBody({
        prompt: params.prompt,
        raw_data: params.rawData,
        title: params.title,
        format: params.format,
        width: params.width,
        height: params.height,
      }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: mapChartQueryShare(await response.json()),
  }),

  outputs: CHARTQUERY_SHARE_OUTPUTS,
}
