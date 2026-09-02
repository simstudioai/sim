import type {
  ConnectorConfigField,
  ConnectorMeta,
  ConnectorTagDefinition,
} from '@/connectors/types'

/**
 * Surface-neutral projection of a knowledge-base connector type.
 *
 * Reads `@/connectors/registry` — the client-safe meta registry — never
 * `@/connectors/registry.server`, whose `listDocuments`/`getDocument`/
 * `validateConfig` closures carry `undici` and the server-only input
 * validators. The projection also drops `icon`, which is a React component.
 */

/** How a connector authenticates against its source. */
export type CatalogConnectorAuth =
  | { mode: 'oauth'; provider: string; requiredScopes?: string[] }
  | { mode: 'apiKey'; label?: string; placeholder?: string; optional: boolean }

/**
 * One field of a connector's `sourceConfig`.
 *
 * Two properties decide how a caller sends the value and are not inferable from
 * the rest of the field:
 *
 * - `multi: true` — the persisted `sourceConfig` value is a `string[]`, not a
 *   `string`. A `selector` field renders a multi-select picker; a `short-input`
 *   accepts a comma-separated list. Either way the stored value is an array.
 * - `canonicalParamId` — links a `selector` field and a manual `short-input`
 *   field that resolve to the SAME `sourceConfig` key. Send exactly one of the
 *   pair, keyed by `canonicalParamId` rather than by the field's own `id`.
 *   `mode` says which half a field is: `basic` is the picker, `advanced` the
 *   manual entry.
 */
export interface CatalogConnectorConfigField {
  id: string
  title: string
  type: 'short-input' | 'dropdown' | 'selector'
  placeholder?: string
  required?: boolean
  description?: string
  options?: { label: string; id: string }[]
  /** Names the picker a `selector` field renders. Its options are fetched per workspace. */
  selectorKey?: string
  mimeType?: string
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  mode?: 'basic' | 'advanced'
  canonicalParamId?: string
  multi?: boolean
}

/** A tag slot a connector populates on the documents it syncs. */
export interface CatalogConnectorTagDefinition {
  id: string
  displayName: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
}

/** A connector type, as a caller configuring one needs to see it. */
export interface CatalogConnectorType {
  /** Registry key — the exact `connectorType` value to send when creating a connector. */
  connectorType: string
  name: string
  description: string
  version: string
  auth: CatalogConnectorAuth
  configFields: CatalogConnectorConfigField[]
  supportsIncrementalSync: boolean
  tagDefinitions: CatalogConnectorTagDefinition[]
}

function projectAuth(auth: ConnectorMeta['auth']): CatalogConnectorAuth {
  if (auth.mode === 'oauth') {
    return {
      mode: 'oauth',
      provider: auth.provider,
      ...(auth.requiredScopes !== undefined ? { requiredScopes: [...auth.requiredScopes] } : {}),
    }
  }
  return {
    mode: 'apiKey',
    optional: auth.optional === true,
    ...(auth.label !== undefined ? { label: auth.label } : {}),
    ...(auth.placeholder !== undefined ? { placeholder: auth.placeholder } : {}),
  }
}

/**
 * Copies a `dependsOn` hint.
 *
 * The connector registry's arrays live for the whole process, so publishing one
 * by reference would hand every caller a mutable handle on shared state. The
 * neighbouring `options` and `tags` projections copy for the same reason.
 */
function copyDependsOn(
  dependsOn: NonNullable<ConnectorConfigField['dependsOn']>
): NonNullable<CatalogConnectorConfigField['dependsOn']> {
  if (Array.isArray(dependsOn)) return [...dependsOn]
  const copied: { all?: string[]; any?: string[] } = {}
  if (dependsOn.all) copied.all = [...dependsOn.all]
  if (dependsOn.any) copied.any = [...dependsOn.any]
  return copied
}

function projectConfigField(field: ConnectorConfigField): CatalogConnectorConfigField {
  const projected: CatalogConnectorConfigField = {
    id: field.id,
    title: field.title,
    type: field.type,
  }
  if (field.placeholder !== undefined) projected.placeholder = field.placeholder
  if (field.required !== undefined) projected.required = field.required
  if (field.description !== undefined) projected.description = field.description
  if (field.options !== undefined)
    projected.options = field.options.map((option) => ({ ...option }))
  if (field.selectorKey !== undefined) projected.selectorKey = field.selectorKey
  if (field.mimeType !== undefined) projected.mimeType = field.mimeType
  if (field.dependsOn !== undefined) projected.dependsOn = copyDependsOn(field.dependsOn)
  if (field.mode !== undefined) projected.mode = field.mode
  if (field.canonicalParamId !== undefined) projected.canonicalParamId = field.canonicalParamId
  if (field.multi !== undefined) projected.multi = field.multi
  return projected
}

function projectTagDefinition(tag: ConnectorTagDefinition): CatalogConnectorTagDefinition {
  return { id: tag.id, displayName: tag.displayName, fieldType: tag.fieldType }
}

/** Projects one connector meta to its catalog entry. */
export function projectConnectorType(
  connectorType: string,
  meta: ConnectorMeta
): CatalogConnectorType {
  return {
    connectorType,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    auth: projectAuth(meta.auth),
    configFields: meta.configFields.map(projectConfigField),
    supportsIncrementalSync: meta.supportsIncrementalSync === true,
    tagDefinitions: (meta.tagDefinitions ?? []).map(projectTagDefinition),
  }
}

/** A connector type as the default list projection publishes it: enough to choose one. */
export interface CatalogConnectorTypeSummary {
  connectorType: string
  name: string
  description: string
  auth: { mode: CatalogConnectorAuth['mode'] }
}

/** Narrows a projected connector type to the summary the list returns by default. */
export function toConnectorTypeSummary(
  connectorType: CatalogConnectorType
): CatalogConnectorTypeSummary {
  return {
    connectorType: connectorType.connectorType,
    name: connectorType.name,
    description: connectorType.description,
    auth: { mode: connectorType.auth.mode },
  }
}
