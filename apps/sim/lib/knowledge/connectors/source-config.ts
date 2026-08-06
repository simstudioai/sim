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
