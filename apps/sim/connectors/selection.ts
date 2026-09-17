import type { ConnectorMeta } from '@/connectors/types'
import { parseMultiValue } from '@/connectors/utils'

/** Persisted scope marker; providers resolve the accessible set during each listing. */
export const ALL_SOURCE_ITEMS = '*'

export function isAllSourceItems(value: unknown): boolean {
  const items = parseMultiValue(value)
  return items.length === 1 && items[0] === ALL_SOURCE_ITEMS
}

export function getSourceSelectionError(
  value: unknown,
  allValue = ALL_SOURCE_ITEMS
): string | undefined {
  const items = parseMultiValue(value)
  if (items.length > 1 && items.includes(allValue)) {
    return `Use "${allValue}" by itself for All, or remove it to select individual items.`
  }
}

export function findSourceSelectionError(
  connector: Pick<ConnectorMeta, 'configFields'>,
  sourceConfig: Record<string, unknown>
): string | undefined {
  for (const field of connector.configFields) {
    if (!field.selectAllValue) continue
    const error = getSourceSelectionError(
      sourceConfig[field.canonicalParamId ?? field.id],
      field.selectAllValue
    )
    if (error) return error
  }
}
