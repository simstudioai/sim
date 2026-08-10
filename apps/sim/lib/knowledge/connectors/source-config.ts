import { omit } from '@sim/utils/object'

/**
 * Keys a caller must never be able to persist into `knowledge_connector.sourceConfig`.
 *
 * `workspaceId` and `knowledgeBaseId` are supplied by the sync engine at run time from
 * the `knowledge_base` row (see `ConnectorSyncContext`). For `sim`-mode connectors that
 * binding is the entire tenancy boundary, so allowing a stored copy would create a
 * second, caller-controlled source of truth for which workspace to read.
 *
 * `tagSlotMapping` is derived during connector creation from the knowledge base's
 * available tag slots; a caller-supplied one would let a connector write into slots it
 * was never allocated.
 */
export const RESERVED_SOURCE_CONFIG_KEYS = [
  'workspaceId',
  'knowledgeBaseId',
  'tagSlotMapping',
] as const

/**
 * Strips {@link RESERVED_SOURCE_CONFIG_KEYS} from a caller-submitted source config.
 * Applied on both create and update so the two paths cannot drift.
 */
export function sanitizeConnectorSourceConfig(
  sourceConfig: Record<string, unknown>
): Record<string, unknown> {
  return omit(sourceConfig, [...RESERVED_SOURCE_CONFIG_KEYS])
}

/**
 * The reserved keys that are legitimately *persisted*, just never by the caller.
 *
 * `workspaceId` and `knowledgeBaseId` are stripped and never stored at all — the
 * engine derives them per run. `tagSlotMapping` is different: it is computed once
 * during creation from the knowledge base's free slots and must survive edits.
 */
const SERVER_OWNED_PERSISTED_KEYS = ['tagSlotMapping'] as const

/**
 * Re-applies server-owned keys from the stored row onto a sanitized update.
 *
 * Update replaces `sourceConfig` wholesale, so sanitizing alone would drop
 * `tagSlotMapping` — which the client never re-sends. Losing it makes
 * `resolveTagMapping` return undefined and the connector silently stops writing
 * tags on every later sync, for every connector that declares `tagDefinitions`.
 * Reading it back from the stored row rather than the request keeps the key
 * server-owned while still surviving an edit.
 */
export function preserveServerOwnedSourceConfig(
  sanitizedUpdate: Record<string, unknown>,
  storedSourceConfig: unknown
): Record<string, unknown> {
  const stored = (storedSourceConfig ?? {}) as Record<string, unknown>
  const preserved: Record<string, unknown> = {}
  for (const key of SERVER_OWNED_PERSISTED_KEYS) {
    if (stored[key] !== undefined) preserved[key] = stored[key]
  }
  return { ...sanitizedUpdate, ...preserved }
}
