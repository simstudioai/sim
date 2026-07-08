import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import {
  clearDependentsOnRemap,
  type ForkRemapKind,
  remapForkSubBlocks,
} from '@/lib/workspaces/fork/remap/remap-references'

/**
 * Resolves a source resource reference to its copied child id, or null when the
 * resource was not copied into the fork. Credentials are never copied (always
 * null), so credential references are cleared.
 */
export type ForkCopyResolver = (kind: ForkRemapKind, sourceId: string) => string | null

/**
 * A `copyWorkflowStateIntoTarget` transform for the initial fork. Runs the shared
 * fork remapper in `create` mode: copyable resources the user selected are
 * rewritten to their child ids; references to resources that were not copied (and
 * all credential references) are cleared so the child workflow's subblocks start
 * empty; env-var `{{KEY}}` references are preserved (name-based, they resolve once
 * the child defines the key).
 */
export function createForkBootstrapTransform(
  resolveCopied: ForkCopyResolver
): (
  subBlocks: SubBlockRecord,
  blockType: string,
  canonicalModes?: CanonicalModeOverrides
) => SubBlockRecord {
  return (subBlocks, blockType, canonicalModes) => {
    // Every resolution at fork-create IS a copy (the resolver is the copy id map), so all
    // remapped keys carry copy provenance - copy-faithful dependents (column picks) survive.
    // `blockType`/`canonicalModes` activate the mode policy: active basic remaps, active
    // advanced (manual) passes through with its dependents, dormant members clear.
    const result = remapForkSubBlocks(subBlocks, resolveCopied, 'create', {
      blockType,
      canonicalModes,
      isCopiedTarget: (kind, sourceId) => resolveCopied(kind, sourceId) != null,
    })
    return clearDependentsOnRemap(
      result.subBlocks,
      blockType,
      result.remappedKeys,
      canonicalModes,
      result.copyRemappedKeys
    )
  }
}
