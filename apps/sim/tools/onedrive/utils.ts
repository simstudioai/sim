import type { OneDriveToolParams } from '@/tools/onedrive/types'

export type ExcelCell = string | number | boolean | null
export type ExcelArrayValues = ExcelCell[][]
export type ExcelObjectValues = Array<Record<string, ExcelCell>>
export type NormalizedExcelValues = ExcelArrayValues | ExcelObjectValues

/**
 * Ensures Excel values are always represented as arrays before hitting downstream tooling.
 * Accepts JSON strings, array-of-arrays, or array-of-objects and normalizes them.
 */
export function normalizeExcelValues(values: unknown): NormalizedExcelValues | undefined {
  if (values === null || values === undefined) {
    return undefined
  }

  if (typeof values === 'string') {
    const trimmed = values.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) {
        throw new Error('Excel values must be an array of rows or array of objects')
      }
      return parsed as NormalizedExcelValues
    } catch (_error) {
      throw new Error('Invalid JSON format for values')
    }
  }

  if (Array.isArray(values)) {
    return values as NormalizedExcelValues
  }

  throw new Error('Excel values must be an array of rows or array of objects')
}

/**
 * Convenience helper for contexts that expect the narrower ToolParams typing.
 */
export function normalizeExcelValuesForToolParams(
  values: unknown
): OneDriveToolParams['values'] | undefined {
  const normalized = normalizeExcelValues(values)
  return normalized as OneDriveToolParams['values'] | undefined
}
