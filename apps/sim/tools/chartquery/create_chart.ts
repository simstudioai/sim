import type { ChartQueryCreateChartParams, ChartQueryShareResponse } from '@/tools/chartquery/types'
import { CHARTQUERY_SHARE_OUTPUTS } from '@/tools/chartquery/types'
import {
  CHARTQUERY_API_BASE,
  chartQueryBody,
  chartQueryHeaders,
  mapChartQueryShare,
  parseChartConfig,
} from '@/tools/chartquery/utils'
import type { ToolConfig } from '@/tools/types'

export const chartQueryCreateChartTool: ToolConfig<
  ChartQueryCreateChartParams,
  ChartQueryShareResponse
> = {
  id: 'chartquery_create_chart',
  name: 'ChartQuery Create Chart',
  description:
    'Render a Chart.js v4 chart (bar, line, pie, doughnut, radar, scatter and more) from its config and get public links to the image.',
  version: '1.0.0',

  params: {
    config: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Chart.js v4 config with type, data and optional options (e.g., {"type":"bar","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Sales","data":[12,19]}]}})',
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
      description: 'Image width in pixels, 50 to 4000 (e.g., 800)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image height in pixels, 50 to 4000 (e.g., 400)',
    },
    background: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background color (e.g., "#ffffff" or "transparent")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ChartQuery API key',
    },
  },

  request: {
    url: `${CHARTQUERY_API_BASE}/chart`,
    method: 'POST',
    headers: (params) => chartQueryHeaders(params.apiKey),
    body: (params) =>
      chartQueryBody({
        ...parseChartConfig(params.config),
        format: params.format,
        width: params.width,
        height: params.height,
        background: params.background,
      }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: mapChartQueryShare(await response.json()),
  }),

  outputs: CHARTQUERY_SHARE_OUTPUTS,
}
