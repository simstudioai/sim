import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Links ChartQuery returns when an image is stored with `share: true`. */
export interface ChartQueryShareOutput {
  id: string | null
  renderUrl: string | null
  viewUrl: string | null
  embedHtml: string | null
  expiresIn: string | null
}

export interface ChartQueryShareResponse extends ToolResponse {
  output: ChartQueryShareOutput
}

type ChartQueryImageFormat = 'png' | 'svg'

export interface ChartQueryCreateChartParams {
  apiKey: string
  config: Record<string, unknown> | string
  format?: ChartQueryImageFormat
  width?: number
  height?: number
  background?: string
}

export interface ChartQueryCreateChartFromPromptParams {
  apiKey: string
  prompt: string
  rawData?: string
  title?: string
  format?: ChartQueryImageFormat
  width?: number
  height?: number
}

export interface ChartQueryCreateQrCodeParams {
  apiKey: string
  data: string
  format?: ChartQueryImageFormat
  size?: number
  color?: string
  background?: string
}

export interface ChartQueryCreateBarcodeParams {
  apiKey: string
  data: string
  barcodeType?: string
  format?: ChartQueryImageFormat
  showText?: boolean
}

/** Output schema shared by every ChartQuery tool. */
export const CHARTQUERY_SHARE_OUTPUTS: Record<string, OutputProperty> = {
  id: {
    type: 'string',
    description: 'ID of the stored image',
    optional: true,
  },
  renderUrl: {
    type: 'string',
    description: 'Public URL of the image itself, for an img tag, a message or a document',
    optional: true,
  },
  viewUrl: {
    type: 'string',
    description: 'Public URL of a page that shows the image',
    optional: true,
  },
  embedHtml: {
    type: 'string',
    description: 'HTML iframe snippet that embeds the image page',
    optional: true,
  },
  expiresIn: {
    type: 'string',
    description: 'How long the links stay valid, which depends on the ChartQuery plan',
    optional: true,
  },
}
