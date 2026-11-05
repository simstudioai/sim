import { getReadTargetBlock } from '@/lib/mothership/tools/client/read-block'
import { getBlock } from '@/blocks/registry'

/** A block type's display name. Its own module so a host without the block registry can replace it. */
export function resolveBlockName(type: string): string | undefined {
  return getBlock(type)?.name
}

/** The display name of the block a `read` call targets. Replaced alongside `resolveBlockName`. */
export function resolveReadTargetBlockName(path: string | undefined): string | undefined {
  return getReadTargetBlock(path)?.name
}
