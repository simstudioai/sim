import type { ForkRemapKind } from '@/ee/workspace-forking/lib/remap/remap-references'
import {
  clearDependentsOnRemap,
  remapForkBlockType,
  remapForkSubBlocks,
  type SubBlockTransform,
} from '@/ee/workspace-forking/lib/remap/remap-references'

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
export function createForkBootstrapTransform(resolveCopied: ForkCopyResolver): SubBlockTransform {
  return (subBlocks, blockType, canonicalModes, onCanonicalModesChanged, triggerMode) => {
    // Every resolution at fork-create IS a copy (the resolver is the copy id map), so all
    // remapped keys carry copy provenance - copy-faithful dependents (column picks) survive.
    // `blockType`/`canonicalModes` activate the mode policy: active basic remaps, active
    // advanced (manual) passes through with its dependents, dormant members clear.
    const result = remapForkSubBlocks(subBlocks, resolveCopied, 'create', {
      blockType,
      canonicalModes,
      triggerMode,
      isCopiedTarget: (kind, sourceId) => resolveCopied(kind, sourceId) != null,
    })
    if (result.canonicalModes) onCanonicalModesChanged?.(result.canonicalModes)
    return clearDependentsOnRemap(
      result.subBlocks,
      blockType,
      result.remappedKeys,
      result.canonicalModes ?? canonicalModes,
      result.copyRemappedKeys,
      triggerMode
    )
  }
}

/**
 * A `copyWorkflowStateIntoTarget` block-type transform, for both fork-create and promote.
 *
 * Repoints a placed custom block at the target environment's own published block. Unmapped
 * blocks keep the source's type (there is no empty type to clear to) and are surfaced as
 * unmapped references by `scanWorkflowReferences`, which is what blocks the promote.
 */
export function createForkBlockTypeTransform(
  resolve: ForkCopyResolver
): (blockType: string, block: { id: string; name: string }) => string {
  return (blockType, block) =>
    remapForkBlockType(blockType, resolve, { blockId: block.id, blockName: block.name }).type
}
