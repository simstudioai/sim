import { TypeTtl } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import {
  isTtlTimestamp,
  normalizeTtlTimestamp,
  TTL_FORMAT_ERROR,
  TTL_TIMESTAMP_PATTERN,
  ttlInstantForComparison,
} from '@/lib/table/ttl-values'

export const ttlColumnType: ColumnTypeDefinition = {
  id: 'ttl',
  label: 'Expiration',
  maxPerTable: 1,
  icon: TypeTtl,
  jsonbCast: 'timestamptz',
  timestampPattern: TTL_TIMESTAMP_PATTERN,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31T00:00:00-00:00',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'offset-date',
  expandable: false,
  typeaheadPattern: /\d/,
  parseErrorMessage: TTL_FORMAT_ERROR,

  coerce(value) {
    const normalized = normalizeTtlTimestamp(value)
    return normalized === null ? { ok: false } : { ok: true, value: normalized }
  },

  valueForEquality(value) {
    return ttlInstantForComparison(value) ?? value
  },

  validateCell(value, column) {
    return isTtlTimestamp(value) ? null : `${column.name}: ${TTL_FORMAT_ERROR}`
  },

  validateFilterValue(value, column) {
    return isTtlTimestamp(value) ? null : `${column.name}: ${TTL_FORMAT_ERROR}`
  },

  formatForDisplay(value) {
    return normalizeTtlTimestamp(value) ?? String(value ?? '')
  },

  formatForInput(value) {
    return normalizeTtlTimestamp(value) ?? String(value ?? '')
  },
}
