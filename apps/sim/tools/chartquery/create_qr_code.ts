import type {
  ChartQueryCreateQrCodeParams,
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

export const chartQueryCreateQrCodeTool: ToolConfig<
  ChartQueryCreateQrCodeParams,
  ChartQueryShareResponse
> = {
  id: 'chartquery_create_qr_code',
  name: 'ChartQuery Create QR Code',
  description:
    'Generate a QR code for a URL, text, email, phone number or Wi-Fi network and get public links to the image.',
  version: '1.0.0',

  params: {
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text or URL to encode (e.g., "https://www.chartquery.com")',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image format: svg (default) or png',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width and height in pixels (default 200)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Color of the QR modules as a hex value (e.g., "#4f46e5")',
    },
    background: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background color as a hex value, or "transparent"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ChartQuery API key',
    },
  },

  request: {
    url: `${CHARTQUERY_API_BASE}/qrcode`,
    method: 'POST',
    headers: (params) => chartQueryHeaders(params.apiKey),
    body: (params) =>
      chartQueryBody({
        data: params.data,
        format: params.format,
        size: params.size,
        color: params.color,
        background: params.background,
      }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: mapChartQueryShare(await response.json()),
  }),

  outputs: CHARTQUERY_SHARE_OUTPUTS,
}
