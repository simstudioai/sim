import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_INDEX_PARAM,
  EXCEL_TABLE_PARAM,
  EXCEL_VALUES_OUTPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelInteger,
  excelTableUrl,
  mapExcelRow,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelRowParams, ExcelRowResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const getTableRowTool: ToolConfig<ExcelRowParams, ExcelRowResponse> = {
  id: 'microsoft_excel_get_table_row',
  name: 'Microsoft Excel Get Table Row',
  description: 'Get Table Row in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, tableName: EXCEL_TABLE_PARAM, index: EXCEL_INDEX_PARAM },
  request: {
    url: (params) => `${excelTableUrl(params)}/rows/${excelInteger(params.index, 'index')}`,
    method: 'GET',
    headers: excelHeaders,
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapExcelRow(await readExcelJson(response)),
  }),
  outputs: {
    index: { type: 'number', nullable: true, description: 'Zero-based table row index.' },
    values: { ...EXCEL_VALUES_OUTPUT },
  },
}
