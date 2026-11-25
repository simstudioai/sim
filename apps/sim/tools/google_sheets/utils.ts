import type { ToolConfig, ToolOutputProperty } from '@/tools/types'

type ToolParams = ToolConfig['params']

const VALUE_RENDER_DESCRIPTION =
  '"FORMATTED_VALUE" (default, as displayed), "UNFORMATTED_VALUE" (raw numbers/booleans), or "FORMULA" (formulas instead of results)'

const DATE_TIME_RENDER_DESCRIPTION =
  '"SERIAL_NUMBER" (default, days since 1899-12-30) or "FORMATTED_STRING" (as displayed). Ignored when the value render option is "FORMATTED_VALUE".'

/** Query params `spreadsheets.values.get` / `batchGet` accept for shaping the returned values. */
export const READ_RENDER_PARAMS: ToolParams = {
  majorDimension: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'The major dimension of the returned values: "ROWS" (default) or "COLUMNS"',
  },
  valueRenderOption: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: `How values should be rendered: ${VALUE_RENDER_DESCRIPTION}`,
  },
  dateTimeRenderOption: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: `How dates, times, and durations should be rendered: ${DATE_TIME_RENDER_DESCRIPTION}`,
  },
}

/** Params controlling how `updatedData` is rendered when `includeValuesInResponse` is set. */
export const RESPONSE_RENDER_PARAMS: ToolParams = {
  responseValueRenderOption: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: `How values in updatedData should be rendered (only with includeValuesInResponse): ${VALUE_RENDER_DESCRIPTION}`,
  },
  responseDateTimeRenderOption: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: `How dates in updatedData should be rendered (only with includeValuesInResponse): ${DATE_TIME_RENDER_DESCRIPTION}`,
  },
}

interface ReadRenderOptions {
  majorDimension?: string
  valueRenderOption?: string
  dateTimeRenderOption?: string
}

/** Appends the optional read-shaping query params that are set. */
export function appendReadRenderParams(searchParams: URLSearchParams, params: ReadRenderOptions) {
  if (params.majorDimension) searchParams.append('majorDimension', params.majorDimension)
  if (params.valueRenderOption) searchParams.append('valueRenderOption', params.valueRenderOption)
  if (params.dateTimeRenderOption) {
    searchParams.append('dateTimeRenderOption', params.dateTimeRenderOption)
  }
}

interface ResponseRenderOptions {
  responseValueRenderOption?: string
  responseDateTimeRenderOption?: string
}

/** Appends the optional `updatedData` render params that are set. */
export function appendResponseRenderParams(
  searchParams: URLSearchParams,
  params: ResponseRenderOptions
) {
  if (params.responseValueRenderOption) {
    searchParams.append('responseValueRenderOption', params.responseValueRenderOption)
  }
  if (params.responseDateTimeRenderOption) {
    searchParams.append('responseDateTimeRenderOption', params.responseDateTimeRenderOption)
  }
}

interface RawValueRange {
  range?: string
  majorDimension?: string
  values?: unknown[][]
}

/** Maps a `ValueRange` (e.g. `UpdateValuesResponse.updatedData`), or null when absent. */
export function mapValueRange(raw: RawValueRange | null | undefined) {
  if (!raw) return null
  return {
    range: raw.range ?? '',
    majorDimension: raw.majorDimension ?? 'ROWS',
    values: raw.values ?? [],
  }
}

export const UPDATED_DATA_OUTPUT: ToolOutputProperty = {
  type: 'json',
  description:
    'Values of the updated cells after the write, present only when includeValuesInResponse is true',
  optional: true,
  nullable: true,
  properties: {
    range: { type: 'string', description: 'The A1 range of the returned values' },
    majorDimension: { type: 'string', description: 'Major dimension (ROWS or COLUMNS)' },
    values: { type: 'array', description: 'The cell values as a 2D array' },
  },
}

/** Whether `value` is any object (an array or class instance included) a row reads keys from. */
function isKeyedRow(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Objects as sheet rows: a header row of every key the entries hold, then one row per entry, a
 * nested value as its JSON and a missing one empty. Any object entry (an array included) gives
 * its keys; anything else is an empty row.
 */
function objectsToSheetRows(objects: unknown[]): unknown[][] {
  const headers = [...new Set(objects.flatMap((row) => (isKeyedRow(row) ? Object.keys(row) : [])))]
  const rows = objects.map((row) => {
    if (!isKeyedRow(row)) return Array(headers.length).fill('')
    return headers.map((key) => {
      const value: unknown = Reflect.get(row, key)
      if (value !== null && typeof value === 'object') return JSON.stringify(value)
      return value === undefined ? '' : value
    })
  })
  return [headers, ...rows]
}

/** Whether `values` is a non-empty array whose first entry is an object, not a row. */
function holdsObjects(values: unknown): values is unknown[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    typeof values[0] === 'object' &&
    !Array.isArray(values[0])
  )
}

/** `values` as written: an array of objects as {@link objectsToSheetRows}, anything else as given. */
export function writeSheetRows(values: unknown): unknown {
  const given = values || []
  return holdsObjects(given) ? objectsToSheetRows(given) : given
}

/** `values` parsed from a JSON string, or the string as one cell when it is not JSON. */
function parseSheetValues(values: string): unknown {
  try {
    return JSON.parse(values)
  } catch {
    try {
      return JSON.parse(values.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'))
    } catch {
      return [[values]]
    }
  }
}

/**
 * `values` as appended: a JSON string parsed, an array of objects as {@link objectsToSheetRows},
 * a scalar as one cell, and each scalar entry of an array as a one-cell row.
 */
export function appendSheetRows(values: unknown): unknown[][] {
  const given = values || []
  const parsed = typeof given === 'string' ? parseSheetValues(given) : given
  if (holdsObjects(parsed)) return objectsToSheetRows(parsed)
  if (!Array.isArray(parsed)) return [[String(parsed)]]
  return parsed.map((row) => (Array.isArray(row) ? row : [String(row)]))
}

interface SheetWriteCounts {
  updatedRows: number
  updatedColumns: number
  updatedCells: number
}

/**
 * The counts a write of `values` reports, or null when the request alone cannot say: `values`
 * is not a grid, or a null cell leaves the sheet's value in place.
 */
function sheetWriteCounts(values: unknown, majorDimension: string): SheetWriteCounts | null {
  if (!Array.isArray(values) || !values.every(Array.isArray)) return null
  const rows: unknown[][] = values
  if (rows.some((row) => row.some((cell) => cell === null || cell === undefined))) return null
  const lines = rows.length
  const width = Math.max(0, ...rows.map((row) => row.length))
  const cells = rows.reduce((total, row) => total + row.length, 0)
  const byColumns = majorDimension === 'COLUMNS'
  return {
    updatedRows: byColumns ? width : lines,
    updatedColumns: byColumns ? lines : width,
    updatedCells: cells,
  }
}

/** `values` as updated: a scalar as one cell, and each scalar entry of an array as a one-cell row. */
export function updateSheetRows(values: unknown): unknown[][] {
  const given = values || []
  if (!Array.isArray(given)) return [[given]]
  return given.map((row) => (Array.isArray(row) ? row : [row]))
}

/**
 * A dry run's placeholder for a values write (append, write or update) of `values` as sent: the
 * counts the grid determines, the spreadsheet it names, and `updatedData` (dropped by a tool that
 * does not declare it) holding the values as written, before the sheet renders them, or null when
 * the call asks for none. The ranges the sheet resolves stay placeholders.
 */
export function sheetWritePlaceholder(
  params: {
    spreadsheetId: string
    majorDimension?: string
    includeValuesInResponse?: boolean
  },
  values: unknown
): Record<string, unknown> {
  const majorDimension = params.majorDimension || 'ROWS'
  return {
    ...sheetWriteCounts(values, majorDimension),
    metadata: {
      spreadsheetId: params.spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${params.spreadsheetId}`,
    },
    updatedData: params.includeValuesInResponse ? { majorDimension, values } : null,
  }
}
