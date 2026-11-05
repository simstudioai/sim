import { parseReadTarget } from '@/lib/mothership/tools/client/read-target'
import { getBlock, getLatestBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

/**
 * Resolves the block a copilot `read` call targets when the path references a
 * component schema or organization custom block, so tool rows can show the
 * block's display name and brand icon instead of its raw type id. Returns
 * undefined for every other path, leaving generic read-target labeling
 * untouched.
 */
export function getReadTargetBlock(path: string | undefined): BlockConfig | undefined {
  const target = parseReadTarget(path)
  if (!target) return undefined
  return target.kind === 'block' ? getBlock(target.type) : getLatestBlock(target.type)
}
