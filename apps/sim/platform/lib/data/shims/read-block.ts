import { parseReadTarget } from '@/lib/mothership/tools/client/read-target'
import { resolveBlockName } from '@/platform/lib/data/shims/block-name'

/**
 * Stands in for `lib/mothership/tools/client/read-block`, whose full block config only the legacy
 * tool row's brand icon reads. Here a read names its block and nothing more.
 */
export function getReadTargetBlock(path: string | undefined): { name: string } | undefined {
  const target = parseReadTarget(path)
  const name = target && resolveBlockName(target.type)
  return name ? { name } : undefined
}
