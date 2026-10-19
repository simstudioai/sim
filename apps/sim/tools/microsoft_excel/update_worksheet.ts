import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_SHEET_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  EXCEL_WORKSHEET_OUTPUT,
  excelHeaders,
  excelInteger,
  excelWorksheetUrl,
  mapExcelWorksheet,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type {
  ExcelUpdateWorksheetParams,
  ExcelWorksheetResponse,
} from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const updateWorksheetTool: ToolConfig<ExcelUpdateWorksheetParams, ExcelWorksheetResponse> = {
  id: 'microsoft_excel_update_worksheet',
  name: 'Microsoft Excel Update Worksheet',
  description: 'Update Worksheet in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    ...EXCEL_WORKBOOK_PARAMS,
    sheetName: EXCEL_SHEET_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New worksheet name, unique within the workbook (maximum 31 characters).',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New zero-based worksheet position.',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Visible, Hidden, or VeryHidden.',
    },
  },
  request: {
    url: excelWorksheetUrl,
    method: 'PATCH',
    headers: excelHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body.name = params.name.trim()
      if (params.position !== undefined) body.position = excelInteger(params.position, 'position')
      if (params.visibility !== undefined) {
        if (!['Visible', 'Hidden', 'VeryHidden'].includes(params.visibility))
          throw new Error('Invalid worksheet visibility')
        body.visibility = params.visibility
      }
      if (Object.keys(body).length === 0)
        throw new Error('Provide a name, position, or visibility to update')
      return body
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { worksheet: mapExcelWorksheet(await readExcelJson(response)) },
  }),
  outputs: { worksheet: { ...EXCEL_WORKSHEET_OUTPUT } },
}
