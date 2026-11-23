import { TypeCurrency } from '@sim/emcn/icons'
import { isSupportedCurrencyCode, resolveCurrencyCode } from '@sim/table-cells/currency'
import { CELL_RULES } from '@sim/table-cells/rules'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { formatCurrencyDisplay, formatCurrencyForInput } from '@/lib/table/currency-format'

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

  ...CELL_RULES.currency,

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
