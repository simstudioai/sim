import { TypeCurrency } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import {
  formatCurrencyDisplay,
  formatCurrencyForInput,
  isSupportedCurrencyCode,
  parseCurrencyInput,
  resolveCurrencyCode,
} from '@/lib/table/currency'

export const currencyColumnType: ColumnTypeDefinition = {
  id: 'currency',
  label: 'Currency',
  icon: TypeCurrency,
  jsonbCast: 'numeric',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 123,
  ownedMetadata: ['currencyCode'],
  workflowInputType: 'number',
  editor: 'text',
  expandable: false,
  inputMode: 'decimal',
  acceptsFormattedInput: true,
  // Also accepts the grouping separator and the symbol the user is likely to
  // type first — `parseCurrencyInput` strips both.
  typeaheadPattern: /[\d.,\-\p{Sc}]/u,
  parseErrorMessage: 'Invalid amount',

  coerce(value, column) {
    // Stored as a bare number, but accepts the formatted shapes an amount
    // arrives in — `$1,234.56`, `1 234,56 €`, `(12.00)` — so a paste, CSV
    // import, or tool write lands as a number rather than being nulled.
    const parsed = parseCurrencyInput(value, column.currencyCode)
    return parsed === null ? { ok: false } : { ok: true, value: parsed }
  },

  validateCell(value, column) {
    // A currency cell is a plain number; `currencyCode` is display metadata and
    // never part of the stored value.
    return typeof value === 'number' && !Number.isNaN(value)
      ? null
      : `${column.name} must be number`
  },

  validateDefinition(column) {
    if (column.currencyCode !== undefined && !isSupportedCurrencyCode(column.currencyCode)) {
      return [
        `Column "${column.name}" has invalid currency code "${column.currencyCode}". Use an ISO 4217 code, e.g. USD`,
      ]
    }
    return []
  },

  formatForDisplay(value, column) {
    return formatCurrencyDisplay(value, column.currencyCode)
  },

  formatForInput(value) {
    return formatCurrencyForInput(value)
  },

  defaultMetadata(column) {
    // Always stamped, so the schema states the rendered currency explicitly
    // rather than leaving readers to know the default.
    return { currencyCode: resolveCurrencyCode(column.currencyCode) }
  },
}
