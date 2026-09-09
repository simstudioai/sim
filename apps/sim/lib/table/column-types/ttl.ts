import { TypeTtl } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { isTtlTimestamp, normalizeTtlTimestamp, TTL_FORMAT_ERROR } from '@/lib/table/ttl-values'

export const ttlColumnType: ColumnTypeDefinition = {
  id: 'ttl',
  label: 'Expiration',
  maxPerTable: 1,
  icon: TypeTtl,
  jsonbCast: 'timestamptz',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31T00:00:00Z',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'utc-date',
  expandable: false,
  typeaheadPattern: /\d/,
  parseErrorMessage: TTL_FORMAT_ERROR,

  coerce(value) {
    const normalized = normalizeTtlTimestamp(value)
    return normalized === null ? { ok: false } : { ok: true, value: normalized }
  },

  validateCell(value, column) {
    return isTtlTimestamp(value) ? null : `${column.name}: ${TTL_FORMAT_ERROR}`
  },

  validateFilterValue(value, column) {
    return isTtlTimestamp(value) ? null : `${column.name}: ${TTL_FORMAT_ERROR}`
  },

  formatForDisplay(value) {
    return String(value ?? '')
  },

  formatForInput(value) {
    return String(value ?? '')
  },
}
