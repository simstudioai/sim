import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { ConnectorMeta } from '@/connectors/types'
import { parseMultiValue } from '@/connectors/utils'

/** Compares source settings, ignoring runtime tag mappings and caps cleared in members mode. */
export function searchSourceIdentity(
  meta: Pick<ConnectorMeta, 'configFields' | 'permissionScopedListing'>,
  sourceConfig: unknown = {}
): string {
  if (!isPlainRecord(sourceConfig)) throw new Error('Source settings must be an object')
  const caps = new Set(meta.permissionScopedListing?.capFieldIds ?? [])
  const fields = new Map(
    meta.configFields.map((field) => [field.canonicalParamId ?? field.id, field])
  )
  const values: Array<[string, unknown]> = []
  for (const [id, field] of [...fields].sort(([left], [right]) => left.localeCompare(right))) {
    if (caps.has(id)) continue
    const value = sourceConfig[id]
    if (value === undefined || value === null || value === '') continue
    const normalized = field.multi
      ? [...new Set(parseMultiValue(value))].sort()
      : typeof value === 'string'
        ? value.trim()
        : value
    if (normalized === '' || (Array.isArray(normalized) && normalized.length === 0)) continue
    values.push([id, normalized])
  }
  return JSON.stringify(values)
}

const SOURCE_ADDRESS_FIELDS = new Set([
  'host',
  'domain',
  'project',
  'projectKey',
  'spaceKey',
  'folderId',
  'channel',
  'channelIds',
  'teamId',
  'databaseId',
  'repository',
  'repo',
  'ref',
  'pathPrefix',
])

/** Only declared source addresses are shown; credential and arbitrary config values are never rendered. */
export function describeSearchSource(
  meta: Pick<ConnectorMeta, 'configFields' | 'permissionScopedListing'>,
  sourceConfig: unknown = {}
): string {
  if (!isPlainRecord(sourceConfig)) return ''
  const caps = new Set(meta.permissionScopedListing?.capFieldIds ?? [])
  const fields = new Set(meta.configFields.map((field) => field.canonicalParamId ?? field.id))
  return truncate(
    [...fields]
      .flatMap((id) => {
        if (!SOURCE_ADDRESS_FIELDS.has(id) || caps.has(id)) return []
        const value = sourceConfig[id]
        if (typeof value === 'string' && value.trim()) return [value.trim()]
        if (Array.isArray(value))
          return value.filter((item): item is string => typeof item === 'string')
        return []
      })
      .join(' · '),
    237
  )
}
