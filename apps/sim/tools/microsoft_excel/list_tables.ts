import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_LIST_PARAMS,
  EXCEL_PAGE_OUTPUTS,
  EXCEL_TABLE_OUTPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelPageUrl,
  excelWorkbookUrl,
  mapExcelTable,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelListParams, ExcelTablesResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const listTablesTool: ToolConfig<ExcelListParams, ExcelTablesResponse> = {
  id: 'microsoft_excel_list_tables',
  name: 'Microsoft Excel List Tables',
  description: 'List Tables in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, ...EXCEL_LIST_PARAMS },
  request: {
    url: (params) => excelPageUrl(`${excelWorkbookUrl(params)}/tables`, params),
    method: 'GET',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    const data = await readExcelJson(response)
    if (!Array.isArray(data.value))
      throw new Error('Microsoft Graph returned an invalid collection')
    const tables = data.value.map(mapExcelTable)
    return {
      success: true,
      output: {
        tables,
        count: tables.length,
        nextLink: typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null,
      },
    }
  },
  outputs: {
    tables: {
      type: 'array',
      description: 'Tables in this page.',
      items: { ...EXCEL_TABLE_OUTPUT },
    },
    ...EXCEL_PAGE_OUTPUTS,
  },
}
