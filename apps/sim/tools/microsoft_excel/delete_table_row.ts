import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_INDEX_PARAM,
  EXCEL_TABLE_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelInteger,
  excelTableUrl,
} from '@/tools/microsoft_excel/shared'
import type { ExcelDeleteResponse, ExcelRowParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const deleteTableRowTool: ToolConfig<ExcelRowParams, ExcelDeleteResponse> = {
  id: 'microsoft_excel_delete_table_row',
  name: 'Microsoft Excel Delete Table Row',
  description: 'Delete Table Row in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, tableName: EXCEL_TABLE_PARAM, index: EXCEL_INDEX_PARAM },
  request: {
    url: (params) => `${excelTableUrl(params)}/rows/${excelInteger(params.index, 'index')}`,
    method: 'DELETE',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    await assertExcelSuccess(response)
    return { success: true, output: { deleted: true } }
  },
  outputs: { deleted: { type: 'boolean', description: 'Whether the table row was deleted.' } },
}
