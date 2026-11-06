import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_TABLE_OUTPUT,
  EXCEL_TABLE_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelTableUrl,
  mapExcelTable,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelTableParams, ExcelTableResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const getTableTool: ToolConfig<ExcelTableParams, ExcelTableResponse> = {
  id: 'microsoft_excel_get_table',
  name: 'Microsoft Excel Get Table',
  description: 'Get Table in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, tableName: EXCEL_TABLE_PARAM },
  request: { url: excelTableUrl, method: 'GET', headers: excelHeaders },
  transformResponse: async (response) => ({
    success: true,
    output: { table: mapExcelTable(await readExcelJson(response)) },
  }),
  outputs: { table: { ...EXCEL_TABLE_OUTPUT } },
}
