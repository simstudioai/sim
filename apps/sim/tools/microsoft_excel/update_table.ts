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
import type { ExcelTableResponse, ExcelUpdateTableParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const updateTableTool: ToolConfig<ExcelUpdateTableParams, ExcelTableResponse> = {
  id: 'microsoft_excel_update_table',
  name: 'Microsoft Excel Update Table',
  description: 'Update Table in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    ...EXCEL_WORKBOOK_PARAMS,
    tableName: EXCEL_TABLE_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New unique table name.',
    },
    showHeaders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to show the header row.',
    },
    showTotals: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to show the totals row.',
    },
    style: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Built-in table style (TableStyleLight1–21, TableStyleMedium1–28, TableStyleDark1–11) or a custom style already in the workbook.',
    },
  },
  request: {
    url: excelTableUrl,
    method: 'PATCH',
    headers: excelHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body.name = params.name.trim()
      if (params.showHeaders !== undefined) body.showHeaders = params.showHeaders
      if (params.showTotals !== undefined) body.showTotals = params.showTotals
      if (params.style !== undefined) body.style = params.style
      if (Object.keys(body).length === 0)
        throw new Error('Provide at least one table property to update')
      return body
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { table: mapExcelTable(await readExcelJson(response)) },
  }),
  outputs: { table: { ...EXCEL_TABLE_OUTPUT } },
}
