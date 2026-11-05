import { resolveBlockName } from '@/platform/lib/data/shims/block-name'

/**
 * Stands in for `lib/mothership/tools/client/read-block`, whose full block config only the legacy
 * tool row's brand icon reads. Here a read names its block and nothing more.
 */
export function getReadTargetBlock(path: string | undefined): { name: string } | undefined {
  if (!path) return undefined
  const segments = path.trim().split('/').filter(Boolean)
  const target =
    (segments[0] === 'organization' && segments[1] === 'custom-blocks' && segments.length === 3) ||
    (segments[0] === 'components' && segments[1] === 'blocks' && segments.length === 3) ||
    (segments[0] === 'components' && segments[1] === 'integrations' && segments.length >= 3)
      ? segments[2].replace(/\.json$/, '')
      : undefined
  const name = target && resolveBlockName(target)
  return name ? { name } : undefined
}
