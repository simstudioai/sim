import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_LIST_PARAMS,
  EXCEL_PAGE_OUTPUTS,
  EXCEL_WORKBOOK_PARAMS,
  EXCEL_WORKSHEET_OUTPUT,
  excelHeaders,
  excelPageUrl,
  excelWorkbookUrl,
  mapExcelWorksheet,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelListParams, ExcelWorksheetsResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const listWorksheetsTool: ToolConfig<ExcelListParams, ExcelWorksheetsResponse> = {
  id: 'microsoft_excel_list_worksheets',
  name: 'Microsoft Excel List Worksheets',
  description: 'List Worksheets in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: { ...EXCEL_WORKBOOK_PARAMS, ...EXCEL_LIST_PARAMS },
  request: {
    url: (params) => excelPageUrl(`${excelWorkbookUrl(params)}/worksheets`, params),
    method: 'GET',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    const data = await readExcelJson(response)
    if (!Array.isArray(data.value))
      throw new Error('Microsoft Graph returned an invalid collection')
    const worksheets = data.value.map(mapExcelWorksheet)
    return {
      success: true,
      output: {
        worksheets,
        count: worksheets.length,
        nextLink: typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null,
      },
    }
  },
  outputs: {
    worksheets: {
      type: 'array',
      description: 'Worksheets in this page.',
      items: { ...EXCEL_WORKSHEET_OUTPUT },
    },
    ...EXCEL_PAGE_OUTPUTS,
  },
}
