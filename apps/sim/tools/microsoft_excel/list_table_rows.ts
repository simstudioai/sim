import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_LIST_PARAMS,
  EXCEL_PAGE_OUTPUTS,
  EXCEL_ROW_OUTPUT,
  EXCEL_TABLE_PARAM,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelPageUrl,
  excelTableUrl,
  mapExcelRow,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelListRowsParams, ExcelRowsResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const listTableRowsTool: ToolConfig<ExcelListRowsParams, ExcelRowsResponse> = {
  id: 'microsoft_excel_list_table_rows',
  name: 'Microsoft Excel List Table Rows',
  description: 'List Table Rows in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, ...EXCEL_LIST_PARAMS, tableName: EXCEL_TABLE_PARAM },
  request: {
    url: (params) => excelPageUrl(`${excelTableUrl(params)}/rows`, params),
    method: 'GET',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    const data = await readExcelJson(response)
    if (!Array.isArray(data.value))
      throw new Error('Microsoft Graph returned an invalid collection')
    const rows = data.value.map(mapExcelRow)
    return {
      success: true,
      output: {
        rows,
        count: rows.length,
        nextLink: typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null,
      },
    }
  },
  outputs: {
    rows: {
      type: 'array',
      description: 'Table Rows in this page.',
      items: { ...EXCEL_ROW_OUTPUT },
    },
    ...EXCEL_PAGE_OUTPUTS,
  },
}
