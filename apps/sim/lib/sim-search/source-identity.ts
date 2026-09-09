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
  'rootPageId',
  'projectId',
  'label',
  'repository',
  'repo',
  'ref',
  'pathPrefix',
])

export const SOURCE_LABELS_KEY = '_sourceLabels'

export interface SourceSelectionLabel {
  id: string
  label: string
}

export type SourceSelectionLabels = Record<string, SourceSelectionLabel[]>

interface SourceLabelMetadata {
  identity: string
  fields: SourceSelectionLabels
}

const OPAQUE_SOURCE_FIELDS = new Map([
  ['folderId', 'folder'],
  ['channel', 'channel'],
  ['channelIds', 'channel'],
  ['teamId', 'team'],
  ['databaseId', 'database'],
  ['rootPageId', 'page'],
  ['projectId', 'project'],
  ['label', 'label'],
])

const NAMED_SOURCE_FIELDS = new Map([
  ['project', 'project'],
  ['projectKey', 'project'],
  ['spaceKey', 'space'],
  ['repository', 'repository'],
  ['repo', 'repository'],
])

/** Selection metadata contains display text only, never arbitrary source settings or credentials. */
export function normalizeSourceSelectionLabels(raw: unknown): SourceSelectionLabels {
  if (!isPlainRecord(raw)) return {}
  const labels: SourceSelectionLabels = {}
  for (const id of SOURCE_ADDRESS_FIELDS) {
    const options = raw[id]
    if (!Array.isArray(options) || options.length === 0 || options.length > 50) continue
    if (
      options.some(
        (option) =>
          !isPlainRecord(option) ||
          typeof option.id !== 'string' ||
          !option.id.trim() ||
          option.id.length > 1024 ||
          typeof option.label !== 'string' ||
          !option.label.trim() ||
          option.label.length > 160 ||
          /[\u0000-\u001f\u007f]/.test(option.label) ||
          option.label.trim() === option.id.trim()
      )
    ) {
      continue
    }
    labels[id] = options.map((option) => ({ id: option.id.trim(), label: option.label.trim() }))
  }
  return labels
}

export function createSourceLabelMetadata(
  meta: Pick<ConnectorMeta, 'configFields' | 'permissionScopedListing'>,
  sourceConfig: Record<string, unknown>,
  rawLabels: unknown
): SourceLabelMetadata | undefined {
  const labels = normalizeSourceSelectionLabels(rawLabels)
  const fields: SourceSelectionLabels = {}
  for (const field of meta.configFields) {
    const id = field.canonicalParamId ?? field.id
    if (fields[id] || !labels[id]) continue
    const selected = field.multi
      ? parseMultiValue(sourceConfig[id])
      : typeof sourceConfig[id] === 'string' && sourceConfig[id].trim()
        ? [sourceConfig[id].trim()]
        : []
    const uniqueIds = new Set(selected)
    const optionsById = new Map(labels[id].map((option) => [option.id, option]))
    if (
      uniqueIds.size === 0 ||
      uniqueIds.size !== optionsById.size ||
      !selected.every((value) => optionsById.has(value))
    ) {
      continue
    }
    fields[id] = [...uniqueIds].sort().map((value) => optionsById.get(value)!)
  }
  if (Object.keys(fields).length === 0) return undefined
  const identity = searchSourceIdentity(meta, sourceConfig)
  return identity.length <= 64_000 ? { identity, fields } : undefined
}

/** Config identity and selected IDs must still match the source for saved labels to be usable. */
export function readSourceSelectionLabels(
  meta: Pick<ConnectorMeta, 'configFields' | 'permissionScopedListing'>,
  sourceConfig: unknown
): SourceSelectionLabels {
  if (!isPlainRecord(sourceConfig)) return {}
  const raw = sourceConfig[SOURCE_LABELS_KEY]
  if (
    !isPlainRecord(raw) ||
    typeof raw.identity !== 'string' ||
    raw.identity.length > 64_000 ||
    raw.identity !== searchSourceIdentity(meta, sourceConfig)
  ) {
    return {}
  }
  return createSourceLabelMetadata(meta, sourceConfig, raw.fields)?.fields ?? {}
}

/** Only declared source addresses are shown; credential and arbitrary config values are never rendered. */
export function describeSearchSource(
  meta: Pick<ConnectorMeta, 'configFields' | 'permissionScopedListing'>,
  sourceConfig: unknown = {}
): string {
  if (!isPlainRecord(sourceConfig)) return ''
  const caps = new Set(meta.permissionScopedListing?.capFieldIds ?? [])
  const fields = new Set(meta.configFields.map((field) => field.canonicalParamId ?? field.id))
  const labels = readSourceSelectionLabels(meta, sourceConfig)
  return truncate(
    [...fields]
      .flatMap((id) => {
        if (!SOURCE_ADDRESS_FIELDS.has(id) || caps.has(id)) return []
        const value = sourceConfig[id]
        if (labels[id]) return labels[id].map((option) => option.label)
        const values = parseMultiValue(value)
        const hasOpaqueId = values.some((item) =>
          /^(?:\d+|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(item)
        )
        const noun =
          OPAQUE_SOURCE_FIELDS.get(id) ?? (hasOpaqueId ? NAMED_SOURCE_FIELDS.get(id) : undefined)
        if (noun) {
          const count = new Set(values).size
          const plural = noun === 'repository' ? 'repositories' : `${noun}s`
          return count > 0 ? [`${count} ${count === 1 ? noun : plural} selected`] : []
        }
        if (typeof value === 'string' && value.trim()) return [value.trim()]
        if (Array.isArray(value))
          return value.filter((item): item is string => typeof item === 'string')
        return []
      })
      .join(' · '),
    237
  )
}
