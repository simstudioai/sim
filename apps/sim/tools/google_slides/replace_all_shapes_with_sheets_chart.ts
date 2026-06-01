import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesReplaceAllShapesWithSheetsChartTool')

interface ReplaceAllShapesWithSheetsChartParams {
  accessToken: string
  presentationId: string
  spreadsheetId: string
  chartId: number
  findText: string
  matchCase?: boolean
  linkingMode?: 'LINKED' | 'NOT_LINKED_IMAGE'
  pageObjectIds?: string
}

interface ReplaceAllShapesWithSheetsChartResponse {
  success: boolean
  output: {
    occurrencesChanged: number
    metadata: {
      presentationId: string
      url: string
      findText: string
      spreadsheetId: string
      chartId: number
    }
  }
}

export const replaceAllShapesWithSheetsChartTool: ToolConfig<
  ReplaceAllShapesWithSheetsChartParams,
  ReplaceAllShapesWithSheetsChartResponse
> = {
  id: 'google_slides_replace_all_shapes_with_sheets_chart',
  name: 'Replace All Shapes With Sheets Chart in Slides',
  description:
    "Find every shape matching a text token (e.g. {{revenue-chart}}) and replace each with the same embedded Sheets chart, preserving the shape's position and bounds.",
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Sheets spreadsheet ID containing the chart',
    },
    chartId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Numeric chart ID within the spreadsheet',
    },
    findText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text content of shapes to replace (e.g. {{revenue-chart}})',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-sensitive match (default true)',
    },
    linkingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LINKED (default) or NOT_LINKED_IMAGE',
    },
    pageObjectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated slide IDs to limit replacement to specific slides',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) throw new Error('Spreadsheet ID is required')
      if (params.chartId === undefined) throw new Error('Chart ID is required')
      const findText = params.findText
      if (!findText) throw new Error('Find text is required')

      const request: Record<string, unknown> = {
        spreadsheetId,
        chartId: params.chartId,
        linkingMode: params.linkingMode || 'LINKED',
        containsText: { text: findText, matchCase: params.matchCase !== false },
      }
      if (params.pageObjectIds?.trim()) {
        request.pageObjectIds = params.pageObjectIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      }

      return { requests: [{ replaceAllShapesWithSheetsChart: request }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to replace shapes with sheets chart')
    }
    const occurrencesChanged =
      data.replies?.[0]?.replaceAllShapesWithSheetsChart?.occurrencesChanged ?? 0
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        occurrencesChanged,
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          findText: params?.findText || '',
          spreadsheetId: params?.spreadsheetId?.trim() || '',
          chartId: params?.chartId ?? 0,
        },
      },
    }
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'Number of shapes replaced with the chart',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
        findText: { type: 'string', description: 'The matched text token' },
        spreadsheetId: { type: 'string', description: 'Source spreadsheet ID' },
        chartId: { type: 'number', description: 'Source chart ID' },
      },
    },
  },
}
