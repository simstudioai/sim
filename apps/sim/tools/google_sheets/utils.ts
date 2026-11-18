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
