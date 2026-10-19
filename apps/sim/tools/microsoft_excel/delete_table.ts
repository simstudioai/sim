import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_TABLE_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelTableUrl,
} from '@/tools/microsoft_excel/shared'
import type { ExcelDeleteResponse, ExcelTableParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const deleteTableTool: ToolConfig<ExcelTableParams, ExcelDeleteResponse> = {
  id: 'microsoft_excel_delete_table',
  name: 'Microsoft Excel Delete Table',
  description: 'Delete Table in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, tableName: EXCEL_TABLE_PARAM },
  request: { url: excelTableUrl, method: 'DELETE', headers: excelHeaders },
  transformResponse: async (response) => {
    await assertExcelSuccess(response)
    return { success: true, output: { deleted: true } }
  },
  outputs: { deleted: { type: 'boolean', description: 'Whether the table was deleted.' } },
}
