import { isAccessControlAllowlistRow } from '@/lib/permission-groups/block-access'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { compareEditorBlocks } from '@/ee/access-control/lib/editor'

/**
 * Knowledge base connectors an admin can allow or disallow. `null` config = all
 * allowed. Sorted by display name because the picker is read alphabetically,
 * while the registry is keyed by the snake_case id the server stores. Reads
 * {@link CONNECTOR_META_REGISTRY}, the client-safe metadata half of the
 * connector split.
 */
export const KNOWLEDGE_CONNECTOR_OPTIONS: { value: string; label: string }[] = Object.values(
  CONNECTOR_META_REGISTRY
)
  .map((meta) => ({ value: meta.id, label: meta.name }))
  .sort((a, b) => a.label.localeCompare(b.label))

/**
 * The allowlist UNIVERSE: every access-controllable block, INCLUDING blocks
 * gated for this viewer (they arrive as clones with `hideFromToolbar: true`,
 * clone-not-remove). Materialization and the collapse-to-null comparison must use this viewer-independent set —
 * otherwise a null→partial transition by a non-revealed admin would silently
 * drop a preview block from the stored allowlist and deny it to revealed
 * users already running it.
 *
 * EXCLUDES superseded blocks: materializing `slack` when `slack_v2` is unchecked
 * would re-allow it, since the runtime resolves it back to `slack_v2`. A decision about
 * a retired version is made on its successor's row.
 */
export function getAccessControlBlockUniverse(): BlockConfig[] {
  return getAllBlocks()
    .filter((block) => isAccessControlAllowlistRow(block.type))
    .sort(compareEditorBlocks)
}
