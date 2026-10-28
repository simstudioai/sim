import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
import type {
  ExcelCellValue,
  ExcelRow,
  ExcelTable,
  ExcelWorkbookParams,
  ExcelWorksheet,
} from '@/tools/microsoft_excel/types'
import { getItemBasePath, parseGraphErrorFromData } from '@/tools/microsoft_excel/utils'
import type { OutputProperty, ToolConfig, ToolParameterItemSchema } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const EXCEL_ROW_INPUT = {
  type: 'array',
  minItems: 1,
  maxItems: 100000,
  items: {
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
  },
} as const satisfies ToolParameterItemSchema

export const EXCEL_VALUES_INPUT = {
  anyOf: [EXCEL_ROW_INPUT, { type: 'object', additionalProperties: true }],
} as const satisfies ToolParameterItemSchema

export const EXCEL_WORKBOOK_PARAMS = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Microsoft Excel OAuth access token.',
  },
  spreadsheetId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Workbook drive item ID.',
  },
  driveId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Drive ID for SharePoint or another drive. Defaults to the signed-in user’s OneDrive. Excel workbook APIs require a business account.',
  },
  sessionId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Workbook session ID from Create Session. Omit for a sessionless request that saves changes.',
  },
} satisfies Record<string, ToolConfig['params'][string]>
export const EXCEL_LIST_PARAMS = {
  top: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Page size ($top), from 1 to 1000. Defaults to 100.',
  },
  skip: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Number of items to skip ($skip). Defaults to 0. Increase by the returned count to read the next page.',
  },
} satisfies Record<string, ToolConfig['params'][string]>
export const EXCEL_TABLE_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Table ID or name within the workbook.',
} satisfies ToolConfig['params'][string]
export const EXCEL_SHEET_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Worksheet ID or name within the workbook.',
} satisfies ToolConfig['params'][string]
export const EXCEL_INDEX_PARAM = {
  type: 'number',
  required: true,
  visibility: 'user-or-llm',
  description: 'Zero-based table row index. Indexes can change when rows are inserted or deleted.',
} satisfies ToolConfig['params'][string]
export const EXCEL_WORKSHEET_OUTPUT = {
  type: 'object',
  description: 'Worksheet properties.',
  properties: {
    id: { type: 'string', description: 'Stable worksheet identifier.', nullable: true },
    name: { type: 'string', description: 'Worksheet display name.', nullable: true },
    position: {
      type: 'number',
      description: 'Zero-based position in the workbook.',
      nullable: true,
    },
    visibility: { type: 'string', description: 'Visible, Hidden, or VeryHidden.', nullable: true },
  },
} satisfies OutputProperty
export const EXCEL_TABLE_OUTPUT = {
  type: 'object',
  description: 'Table properties.',
  properties: {
    id: { type: 'string', description: 'Stable table identifier.', nullable: true },
    name: { type: 'string', description: 'Table name.', nullable: true },
    showHeaders: {
      type: 'boolean',
      description: 'Whether the header row is visible.',
      nullable: true,
    },
    showTotals: {
      type: 'boolean',
      description: 'Whether the totals row is visible.',
      nullable: true,
    },
    style: { type: 'string', description: 'Built-in or custom table style.', nullable: true },
    highlightFirstColumn: {
      type: 'boolean',
      description: 'Whether the first column has special formatting.',
      nullable: true,
    },
    highlightLastColumn: {
      type: 'boolean',
      description: 'Whether the last column has special formatting.',
      nullable: true,
    },
    showBandedColumns: {
      type: 'boolean',
      description: 'Whether alternating columns are formatted differently.',
      nullable: true,
    },
    showBandedRows: {
      type: 'boolean',
      description: 'Whether alternating rows are formatted differently.',
      nullable: true,
    },
    showFilterButton: {
      type: 'boolean',
      description: 'Whether header filter buttons are visible.',
      nullable: true,
    },
    legacyId: {
      type: 'string',
      description: 'Opaque legacy identifier used by older Excel clients.',
      nullable: true,
    },
  },
} satisfies OutputProperty
export const EXCEL_VALUES_OUTPUT = {
  type: 'array',
  description: 'Two-dimensional cell values; cells contain strings, numbers, booleans, or null.',
  items: { type: 'array', description: 'Row of scalar cell values.' },
} satisfies OutputProperty
export const EXCEL_ROW_OUTPUT = {
  type: 'object',
  description: 'Table row.',
  properties: {
    index: { type: 'number', description: 'Zero-based row index.', nullable: true },
    values: { ...EXCEL_VALUES_OUTPUT },
  },
} satisfies OutputProperty
export const EXCEL_PAGE_OUTPUTS = {
  nextLink: {
    type: 'string',
    description:
      'Provider continuation link, when supplied. This tool pages with top and skip; it does not follow links automatically.',
    nullable: true,
  },
  count: {
    type: 'number',
    description: 'Number of items returned in this page, not a total count.',
  },
} satisfies Record<string, OutputProperty>

/** Workbook headers preserve the caller’s session for every request. */
export function excelHeaders(
  params: Pick<ExcelWorkbookParams, 'accessToken' | 'sessionId'>
): Record<string, string> {
  if (!params.accessToken) throw new Error('Access token is required')
  return {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
    ...(params.sessionId?.trim() ? { 'workbook-session-id': params.sessionId.trim() } : {}),
  }
}
/** Build the fixed Microsoft Graph workbook endpoint after validating item and drive IDs. */
export function excelWorkbookUrl(params: ExcelWorkbookParams): string {
  return `${getItemBasePath(params.spreadsheetId, params.driveId)}/workbook`
}
/** Address a workbook table by its safely encoded ID or name. */
export function excelTableUrl(params: ExcelWorkbookParams & { tableName: string }): string {
  return `${excelWorkbookUrl(params)}/tables/${safeUrlPathSegment(params.tableName, 'tableName')}`
}
/** Address a workbook worksheet by its safely encoded ID or name. */
export function excelWorksheetUrl(params: ExcelWorkbookParams & { sheetName: string }): string {
  return `${excelWorkbookUrl(params)}/worksheets/${safeUrlPathSegment(params.sheetName, 'sheetName')}`
}
/** Require a safe integer in the inclusive bounds, defaulting to the non-negative Int32 range. */
export function excelInteger(
  value: number,
  name: string,
  minimum = 0,
  maximum = 2147483647
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  return value
}
/** Add bounded pagination: 100 items by default, at most 1000, with a non-negative offset. */
export function excelPageUrl(url: string, params: { top?: number; skip?: number }): string {
  const query = new URLSearchParams({
    $top: String(excelInteger(params.top ?? 100, 'top', 1, 1000)),
    $skip: String(excelInteger(params.skip ?? 0, 'skip')),
  })
  return `${url}?${query}`
}
/** Reject unsuccessful Graph responses with the provider error message or HTTP status. */
export async function assertExcelSuccess(response: Response): Promise<void> {
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    throw new Error(
      parseGraphErrorFromData(data) ?? `Microsoft Graph request failed (${response.status})`
    )
  }
}
/** Require a successful JSON object response before projecting workbook data. */
export async function readExcelJson(response: Response): Promise<Record<string, unknown>> {
  await assertExcelSuccess(response)
  const data: unknown = await response.json()
  if (!isRecordLike(data)) throw new Error('Microsoft Graph returned an invalid response object')
  return data
}
/** Project worksheet fields, representing missing provider scalars as null. */
export function mapExcelWorksheet(value: unknown): ExcelWorksheet {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    name: toStringOrNull(data.name),
    position: toNumberOrNull(data.position),
    visibility: toStringOrNull(data.visibility),
  }
}
/** Project table fields, representing missing provider scalars as null. */
export function mapExcelTable(value: unknown): ExcelTable {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    name: toStringOrNull(data.name),
    showHeaders: toBooleanOrNull(data.showHeaders),
    showTotals: toBooleanOrNull(data.showTotals),
    style: toStringOrNull(data.style),
    highlightFirstColumn: toBooleanOrNull(data.highlightFirstColumn),
    highlightLastColumn: toBooleanOrNull(data.highlightLastColumn),
    showBandedColumns: toBooleanOrNull(data.showBandedColumns),
    showBandedRows: toBooleanOrNull(data.showBandedRows),
    showFilterButton: toBooleanOrNull(data.showFilterButton),
    legacyId: toStringOrNull(data.legacyId),
  }
}
/** Project a table row, defaulting missing values to an empty matrix. */
export function mapExcelRow(value: unknown): ExcelRow {
  const data = toRecord(value)
  return {
    index: toNumberOrNull(data.index),
    values: Array.isArray(data.values) ? (data.values as ExcelCellValue[][]) : [],
  }
}
/** Preserve the established object-row convenience format, with a finite materialization budget. */
export function normalizeExcelValues(
  value: unknown,
  {
    includeHeaders = false,
    matrixOnly = false,
  }: { includeHeaders?: boolean; matrixOnly?: boolean } = {}
): ExcelCellValue[][] {
  if (typeof value === 'string' && value.length > 10 * 1024 * 1024)
    throw new Error('Excel values exceed the 10 MiB input limit')
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 10000)
    throw new Error('Values must contain between 1 and 10000 rows')
  if (matrixOnly && !parsed.every(Array.isArray))
    throw new Error('Values must be a two-dimensional array in worksheet or table column order')
  let rows: unknown[][]
  if (isRecordLike(parsed[0])) {
    const keySet = new Set<string>()
    for (const row of parsed) {
      if (!isRecordLike(row))
        throw new Error('Object rows cannot be mixed with arrays or scalar values')
      for (const key of Object.keys(row)) {
        keySet.add(key)
        if (keySet.size * (parsed.length + (includeHeaders ? 1 : 0)) > 100000)
          throw new Error('Values must contain at most 100000 cells')
      }
    }
    const keys = [...keySet]
    rows = parsed.map((row) =>
      keys.map((key) => {
        const cell = Object.hasOwn(row, key) ? toRecord(row)[key] : undefined
        return isRecordLike(cell) || Array.isArray(cell)
          ? JSON.stringify(cell)
          : cell === undefined
            ? ''
            : cell
      })
    )
    if (includeHeaders) rows.unshift(keys)
  } else {
    rows = Array.isArray(parsed[0]) ? parsed : [parsed]
  }
  if (rows[0].length === 0) throw new Error('Values must contain at least one column')
  let cells = 0
  for (const row of rows) {
    if (!Array.isArray(row)) throw new Error('Values must be a rectangular array of rows')
    cells += row.length
    if (cells > 100000 || row.length !== rows[0].length)
      throw new Error('Values must be rectangular and contain at most 100000 cells')
    for (const cell of row)
      if (
        cell !== null &&
        typeof cell !== 'string' &&
        typeof cell !== 'boolean' &&
        !(typeof cell === 'number' && Number.isFinite(cell))
      )
        throw new Error('Cell values must be strings, finite numbers, booleans, or null')
  }
  return rows as ExcelCellValue[][]
}

export const EXCEL_RANGE_OUTPUTS = {
  values: { ...EXCEL_VALUES_OUTPUT },
  addressLocal: { type: 'string', nullable: true, description: 'Localized range address.' },
  cellCount: { type: 'number', nullable: true, description: 'Cell count in the returned range.' },
  columnCount: {
    type: 'number',
    nullable: true,
    description: 'Column count in the returned range.',
  },
  columnHidden: { type: 'boolean', nullable: true, description: 'Whether all columns are hidden.' },
  columnIndex: { type: 'number', nullable: true, description: 'Zero-based first column index.' },
  formulas: {
    type: 'array',
    description: 'A1 formulas for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
  formulasLocal: {
    type: 'array',
    description: 'Localized A1 formulas for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
  formulasR1C1: {
    type: 'array',
    description: 'R1C1 formulas for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
  hidden: { type: 'boolean', nullable: true, description: 'Whether all cells are hidden.' },
  numberFormat: {
    type: 'array',
    description: 'Number format codes for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
  rowCount: { type: 'number', nullable: true, description: 'Row count in the returned range.' },
  rowHidden: { type: 'boolean', nullable: true, description: 'Whether all rows are hidden.' },
  rowIndex: { type: 'number', nullable: true, description: 'Zero-based first row index.' },
  text: {
    type: 'array',
    description: 'Formatted text for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
  valueTypes: {
    type: 'array',
    description: 'Cell value types for the full returned range.',
    items: { type: 'array', description: 'Row of cell data.' },
  },
} satisfies Record<string, OutputProperty>

/** Project range metadata, with nullable scalars and empty matrices for missing fields. */
export function mapExcelRange(data: Record<string, unknown>) {
  return {
    values: Array.isArray(data.values) ? (data.values as ExcelCellValue[][]) : [],
    addressLocal: toStringOrNull(data.addressLocal),
    cellCount: toNumberOrNull(data.cellCount),
    columnCount: toNumberOrNull(data.columnCount),
    columnHidden: toBooleanOrNull(data.columnHidden),
    columnIndex: toNumberOrNull(data.columnIndex),
    formulas: Array.isArray(data.formulas) ? (data.formulas as ExcelCellValue[][]) : [],
    formulasLocal: Array.isArray(data.formulasLocal)
      ? (data.formulasLocal as ExcelCellValue[][])
      : [],
    formulasR1C1: Array.isArray(data.formulasR1C1) ? (data.formulasR1C1 as ExcelCellValue[][]) : [],
    hidden: toBooleanOrNull(data.hidden),
    numberFormat: Array.isArray(data.numberFormat) ? (data.numberFormat as ExcelCellValue[][]) : [],
    rowCount: toNumberOrNull(data.rowCount),
    rowHidden: toBooleanOrNull(data.rowHidden),
    rowIndex: toNumberOrNull(data.rowIndex),
    text: Array.isArray(data.text) ? (data.text as ExcelCellValue[][]) : [],
    valueTypes: Array.isArray(data.valueTypes) ? (data.valueTypes as ExcelCellValue[][]) : [],
  }
}
