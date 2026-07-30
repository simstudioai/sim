import { getBlock, getLatestBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

/**
 * Resolves the block a copilot `read` call targets when the path is a
 * component schema — `components/blocks/{type}.json` or
 * `components/integrations/{service}/{operation}.json` — so tool rows can show
 * the block's display name and brand icon instead of the raw type id
 * (e.g. "Gmail" instead of `gmail_v2`). Returns undefined for every other
 * path, leaving the generic read-target labeling untouched.
 */
export function getReadTargetBlock(path: string | undefined): BlockConfig | undefined {
  if (!path) return undefined
  const segments = path.trim().split('/').filter(Boolean)
  if (segments[0] !== 'components' || segments.length < 3) return undefined
  if (segments[1] === 'blocks' && segments.length === 3) {
    return getBlock(segments[2].replace(/\.json$/, ''))
  }
  if (segments[1] === 'integrations') {
    return getLatestBlock(segments[2])
  }
  return undefined
}
