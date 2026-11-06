import { BLOCK_NAMES } from '@/lib/block-metadata/names.generated'
import { parseReadTarget } from '@/lib/mothership/tools/client/read-target'
import { BLOCK_ACCESS_SUCCESSORS } from '@/lib/permission-groups/block-successors.generated'
import { resolveOverlayBlock } from '@/blocks/custom/overlay'

/**
 * Stands in for `lib/mothership/tools/client/block-name`, which reaches the whole block registry to
 * read one display name. A retired type reads as the block that replaced it, without "(Legacy)".
 */
export function resolveBlockName(type: string): string | undefined {
  for (const candidate of [type, type.replace(/-/g, '_')]) {
    if (Object.hasOwn(BLOCK_NAMES, candidate)) return BLOCK_NAMES[candidate]
    if (Object.hasOwn(BLOCK_ACCESS_SUCCESSORS, candidate))
      return BLOCK_NAMES[BLOCK_ACCESS_SUCCESSORS[candidate]]
  }
  return resolveOverlayBlock(type)?.name
}

/** A `read` call names its block and nothing more: the block config serves only a legacy brand icon. */
export function resolveReadTargetBlockName(path: string | undefined): string | undefined {
  const target = parseReadTarget(path)
  return target ? resolveBlockName(target.type) : undefined
}
