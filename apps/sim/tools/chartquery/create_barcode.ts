import type {
  ChartQueryCreateBarcodeParams,
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

export const chartQueryCreateBarcodeTool: ToolConfig<
  ChartQueryCreateBarcodeParams,
  ChartQueryShareResponse
> = {
  id: 'chartquery_create_barcode',
  name: 'ChartQuery Create Barcode',
  description:
    'Generate a barcode (Code 128, EAN-13, UPC-A, ITF-14, Code 39 and more) and get public links to the image.',
  version: '1.0.0',

  params: {
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Value to encode; must match the barcode type (e.g., "4006381333931" for EAN-13)',
    },
    barcodeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Barcode type: code128 (default), ean13, ean8, upca, upce, itf14, itf, code39 or code93',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image format: svg (default) or png',
    },
    showText: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to print the encoded value under the bars',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ChartQuery API key',
    },
  },

  request: {
    url: `${CHARTQUERY_API_BASE}/barcode`,
    method: 'POST',
    headers: (params) => chartQueryHeaders(params.apiKey),
    body: (params) =>
      chartQueryBody({
        data: params.data,
        type: params.barcodeType,
        format: params.format,
        show_text: params.showText,
      }),
  },

  transformResponse: async (response) => ({
    success: true,
    output: mapChartQueryShare(await response.json()),
  }),

  outputs: CHARTQUERY_SHARE_OUTPUTS,
}
