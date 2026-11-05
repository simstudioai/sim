import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'

/** Encodes one spreadsheet-safe record using the same escaping as the app's CSV exports. */
export function csvRow(values: readonly unknown[]): string {
  return toCsvRow(values.map((value) => formatCsvValue(value)))
}
