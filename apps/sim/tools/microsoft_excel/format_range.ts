import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftExcelFormatRangeParams,
  MicrosoftExcelFormatRangeResponse,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  getItemBasePath,
  getSpreadsheetWebUrl,
  parseGraphErrorMessage,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Builds the font PATCH body from the provided font params, omitting any unset fields.
 * Returns null when no font property was supplied.
 */
function buildFontBody(params: MicrosoftExcelFormatRangeParams): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (params.fontBold !== undefined) body.bold = params.fontBold
  if (params.fontItalic !== undefined) body.italic = params.fontItalic
  if (params.fontColor) body.color = params.fontColor
  if (params.fontSize !== undefined) body.size = params.fontSize
  if (params.fontName) body.name = params.fontName
  return Object.keys(body).length > 0 ? body : null
}

/**
 * Formats a worksheet range by applying fill color and/or font properties.
 * Uses Microsoft Graph PATCH on range(...)/format/fill and range(...)/format/font.
 * The font update is the primary request; a fill update (when also requested) runs
 * as a follow-up call so a single tool invocation can set both.
 */
export const formatRangeTool: ToolConfig<
  MicrosoftExcelFormatRangeParams,
  MicrosoftExcelFormatRangeResponse
> = {
  id: 'microsoft_excel_format_range',
  name: 'Format Microsoft Excel Range',
  description: 'Apply fill color and/or font formatting to a range in a Microsoft Excel worksheet',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Excel API',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the spreadsheet/workbook (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses personal OneDrive.',
    },
    sheetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the worksheet (e.g., "Sheet1"). If omitted, the range must use the combined "Sheet1!A1:B2" format.',
    },
    range: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The cell range to format (e.g., "A1:D10" or "Sheet1!A1:D10")',
    },
    fillColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Background fill color as an HTML hex code (e.g., "#FFFF00") or named color (e.g., "yellow").',
    },
    fontBold: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the font is bold.',
    },
    fontItalic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the font is italic.',
    },
    fontColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Font color as an HTML hex code (e.g., "#FF0000") or named color (e.g., "red").',
    },
    fontSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Font size in points (e.g., 12).',
    },
    fontName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Font name (e.g., "Calibri").',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      const fontBody = buildFontBody(params)
      const hasFill = Boolean(params.fillColor)
      if (!fontBody && !hasFill) {
        throw new Error('Provide at least a fill color or a font property to format the range')
      }

      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      const rangeUrl = buildWorksheetRangeUrl(basePath, params.range, params.sheetName)
      return fontBody ? `${rangeUrl}/format/font` : `${rangeUrl}/format/fill`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const fontBody = buildFontBody(params)
      if (fontBody) return fontBody
      return { color: params.fillColor }
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftExcelFormatRangeParams) => {
    if (!params) {
      throw new Error('Format parameters are required')
    }
    const accessToken = params.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }

    const spreadsheetId = params.spreadsheetId?.trim() || ''
    const driveId = params.driveId

    const fontBody = buildFontBody(params)
    const hasFill = Boolean(params.fillColor)

    let fontResult: Record<string, unknown> | null = null
    let fillApplied = false

    if (fontBody) {
      fontResult = await response.json().catch(() => null)

      // When both font and fill were requested, the primary request handled the
      // font; apply the fill as a follow-up call.
      if (hasFill) {
        const basePath = getItemBasePath(spreadsheetId, driveId)
        const fillUrl = `${buildWorksheetRangeUrl(basePath, params.range, params.sheetName)}/format/fill`
        const fillResp = await fetch(fillUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ color: params.fillColor }),
        })
        if (!fillResp.ok) {
          const errorText = await fillResp.text().catch(() => '')
          const detail = parseGraphErrorMessage(fillResp.status, fillResp.statusText, errorText)
          // Graph has no single endpoint to set font and fill together, so they are
          // two PATCHes. The font already succeeded here; surface that explicitly so
          // the partial state is clear. Formatting is idempotent — re-running with only
          // the fill color safely finishes the operation.
          throw new Error(
            `Font formatting was applied, but the fill color update failed: ${detail}. Re-run with only the fill color to finish.`
          )
        }
        fillApplied = true
      }
    } else if (hasFill) {
      fillApplied = true
    }

    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

    return {
      success: true,
      output: {
        formatted: true,
        range: params.range ?? '',
        fill: fillApplied ? { color: params.fillColor ?? null } : null,
        font: fontBody
          ? {
              bold: (fontResult?.bold as boolean | undefined) ?? params.fontBold ?? null,
              italic: (fontResult?.italic as boolean | undefined) ?? params.fontItalic ?? null,
              color: (fontResult?.color as string | undefined) ?? params.fontColor ?? null,
              name: (fontResult?.name as string | undefined) ?? params.fontName ?? null,
              size: (fontResult?.size as number | undefined) ?? params.fontSize ?? null,
            }
          : null,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    formatted: { type: 'boolean', description: 'Whether the formatting was applied' },
    range: { type: 'string', description: 'The range that was formatted' },
    fill: {
      type: 'object',
      description: 'The applied fill, or null if no fill was set',
      properties: {
        color: { type: 'string', description: 'The applied fill color' },
      },
    },
    font: {
      type: 'object',
      description: 'The applied font properties, or null if no font was set',
      properties: {
        bold: { type: 'boolean', description: 'Whether the font is bold' },
        italic: { type: 'boolean', description: 'Whether the font is italic' },
        color: { type: 'string', description: 'The font color' },
        name: { type: 'string', description: 'The font name' },
        size: { type: 'number', description: 'The font size in points' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Spreadsheet metadata',
      properties: {
        spreadsheetId: { type: 'string', description: 'The ID of the spreadsheet' },
        spreadsheetUrl: { type: 'string', description: 'URL to access the spreadsheet' },
      },
    },
  },
}
