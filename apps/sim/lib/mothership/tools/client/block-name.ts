import { REGISTERED_BLOCK_NAMES } from '@/lib/block-metadata/names.generated'
import { parseReadTarget } from '@/lib/mothership/tools/client/read-target'
import { resolveOverlayBlock } from '@/blocks/custom/overlay'
import { latestVersionKey } from '@/blocks/versions'

function registeredName(type: string): string | undefined {
  return Object.hasOwn(REGISTERED_BLOCK_NAMES, type) ? REGISTERED_BLOCK_NAMES[type] : undefined
}

/**
 * A block type's display name, as `getBlock(type)?.name` reads it, from generated names so chat
 * tool rows never load the block registry.
 */
export function resolveBlockName(type: string): string | undefined {
  return (
    registeredName(type) ??
    registeredName(type.replace(/-/g, '_')) ??
    resolveOverlayBlock(type)?.name
  )
}

/**
 * The display name of the block a `read` call targets: the exact block for a component schema or
 * custom block, and the newest version of an integration, as `getLatestBlock` resolves it.
 */
export function resolveReadTargetBlockName(path: string | undefined): string | undefined {
  const target = parseReadTarget(path)
  if (!target) return undefined
  if (target.kind === 'block') return resolveBlockName(target.type)
  const normalized = target.type.replace(/-/g, '_')
  return registeredName(
    latestVersionKey(Object.keys(REGISTERED_BLOCK_NAMES), normalized) ?? normalized
  )
}
