import type { IconName } from '@sim/emcn/icon'
import {
  ALL_COLUMN_TYPES,
  type ColumnDefinition,
  wouldExceedColumnTypeLimit,
} from '@/platform/lib/data/tables'

/**
 * A column type a picker offers. `'workflow'` is the virtual entry that spawns a workflow group; the
 * columns it creates are stored as scalar types, none of which is `'workflow'`.
 */
type SidebarColumnType = ColumnDefinition['type'] | 'workflow'

export interface ColumnTypeOption {
  type: SidebarColumnType
  label: string
  icon: IconName
  maxPerTable?: number
  disabledReason?: string
}

/** Each stored type's glyph; the registry names the legacy icon, the zone draws the EMCN one. */
const COLUMN_TYPE_GLYPHS: Record<string, IconName> = {
  string: 'type-text',
  number: 'type-number',
  currency: 'type-currency',
  boolean: 'type-boolean',
  date: 'calendar',
  json: 'type-json',
  select: 'tag',
  ttl: 'type-ttl',
}

/** The glyph for a stored column type; an unknown type reads as text, as the registry falls back. */
export function columnTypeGlyph(type: string): IconName {
  return COLUMN_TYPE_GLYPHS[type] ?? 'type-text'
}

/**
 * Real column types come from the registry, so a type added there appears in every picker; Workflow
 * is appended because it is a picker affordance, not a storable type.
 */
const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = [
  ...ALL_COLUMN_TYPES.map((definition) => ({
    type: definition.id,
    label: definition.label,
    icon: columnTypeGlyph(definition.id),
    maxPerTable: definition.maxPerTable,
  })),
  { type: 'workflow', label: 'Workflow', icon: 'play' },
]

function columnTypeLimitMessage(label: string, maxPerTable: number): string {
  return maxPerTable === 1
    ? `Only one ${label} column allowed per table`
    : `Only ${maxPerTable} ${label} columns allowed per table`
}

/** Picker entries, with a cardinality-limited type the table has used up marked unavailable. */
export function columnTypeOptionsForTable(
  columns: readonly ColumnDefinition[],
  currentColumn: ColumnDefinition | null | undefined
): ColumnTypeOption[] {
  return COLUMN_TYPE_OPTIONS.map((option) => {
    if (option.type === 'workflow') return option
    if (currentColumn?.type === option.type) return option
    if (option.maxPerTable === undefined) return option
    if (!wouldExceedColumnTypeLimit(columns, option.type, 1)) return option
    return {
      ...option,
      disabledReason: columnTypeLimitMessage(option.label, option.maxPerTable),
    }
  })
}
