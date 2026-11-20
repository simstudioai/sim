import { TypeTtl } from '@sim/emcn/icons'
import { CELL_RULES } from '@sim/table-cells/rules'
import {
  isTtlTimestamp,
  normalizeTtlTimestamp,
  TTL_FORMAT_ERROR,
  TTL_TIMESTAMP_VALIDATION,
} from '@sim/table-cells/ttl'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'

export const ttlColumnType: ColumnTypeDefinition = {
  id: 'ttl',
  label: 'Expiration',
  maxPerTable: 1,
  icon: TypeTtl,
  jsonbCast: 'timestamptz',
  timestampValidation: TTL_TIMESTAMP_VALIDATION,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31T00:00:00-00:00',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'offset-date',
  expandable: false,
  typeaheadPattern: /\d/,
  parseErrorMessage: TTL_FORMAT_ERROR,

  ...CELL_RULES.ttl,

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
