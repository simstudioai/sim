import { parseMultiValue } from '@/connectors/utils'

/** Persisted scope marker; providers resolve the accessible set during each listing. */
export const ALL_SOURCE_ITEMS = '*'

export function isAllSourceItems(value: unknown): boolean {
  const items = parseMultiValue(value)
  return items.length === 1 && items[0] === ALL_SOURCE_ITEMS
}
