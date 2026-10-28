import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_INDEX_PARAM,
  EXCEL_ROW_INPUT,
  EXCEL_TABLE_PARAM,
  EXCEL_VALUES_OUTPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelInteger,
  excelTableUrl,
  mapExcelRow,
  normalizeExcelValues,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type { ExcelRowResponse, ExcelUpdateRowParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const updateTableRowTool: ToolConfig<ExcelUpdateRowParams, ExcelRowResponse> = {
  id: 'microsoft_excel_update_table_row',
  name: 'Microsoft Excel Update Table Row',
  description: 'Update Table Row in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    ...EXCEL_WORKBOOK_PARAMS,
    tableName: EXCEL_TABLE_PARAM,
    index: EXCEL_INDEX_PARAM,
    values: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 1,
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exactly one row as a two-dimensional array, in table column order. Use null to leave a cell unchanged.',
    },
  },
  request: {
    url: (params) => `${excelTableUrl(params)}/rows/${excelInteger(params.index, 'index')}`,
    method: 'PATCH',
    headers: excelHeaders,
    body: (params) => {
      const values = normalizeExcelValues(params.values, { matrixOnly: true })
      if (values.length !== 1) throw new Error('Update Table Row requires exactly one row')
      return { values }
    },
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
