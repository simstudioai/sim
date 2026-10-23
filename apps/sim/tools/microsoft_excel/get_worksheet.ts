import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_SHEET_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  EXCEL_WORKSHEET_OUTPUT,
  excelHeaders,
  excelWorksheetUrl,
  mapExcelWorksheet,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelWorksheetParams, ExcelWorksheetResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const getWorksheetTool: ToolConfig<ExcelWorksheetParams, ExcelWorksheetResponse> = {
  id: 'microsoft_excel_get_worksheet',
  name: 'Microsoft Excel Get Worksheet',
  description: 'Get Worksheet in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, sheetName: EXCEL_SHEET_PARAM },
  request: { url: excelWorksheetUrl, method: 'GET', headers: excelHeaders },
  transformResponse: async (response) => ({
    success: true,
    output: { worksheet: mapExcelWorksheet(await readExcelJson(response)) },
  }),
  outputs: { worksheet: { ...EXCEL_WORKSHEET_OUTPUT } },
}
