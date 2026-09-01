import {
  type CatalogGate,
  isBlockVisibleToCaller,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import { getAllBlocks } from '@/blocks/registry'
import { resolveToolId } from '@/tools/tool-ids'

const VERSION_SUFFIX = /^\d+$/

/**
 * The newest visible version of a tool name, or the name unchanged when none is.
 *
 * The detail-read counterpart of {@link resolveVisibleToolIds}, and the tool
 * analogue of `getLatestBlockForViewer`: "newest registered" and "newest visible
 * to this caller" are different questions. `@/tools/tool-ids` answers the first
 * — and superseded v1 tools stay registered so execution of a stored id keeps
 * working, so `resolveToolId('github_comment')` returns `github_comment`, which
 * no visible block exposes. Resolving against the visible set instead walks down
 * to `github_comment_v2`, the id the tool list publishes.
 *
 * An id that is itself visible is returned untouched, so an exact versioned
 * request never silently answers with a different version.
 */
export function resolveVisibleToolId(toolId: string, visibleToolIds: ReadonlySet<string>): string {
  if (visibleToolIds.has(toolId)) return toolId

  const prefix = `${toolId}_v`
  let bestId: string | undefined
  let bestVersion = 0
  for (const candidate of visibleToolIds) {
    if (!candidate.startsWith(prefix)) continue
    const suffix = candidate.slice(prefix.length)
    if (!VERSION_SUFFIX.test(suffix)) continue
    const version = Number.parseInt(suffix, 10)
    if (version > bestVersion) {
      bestVersion = version
      bestId = candidate
    }
  }
  return bestId ?? toolId
}

/**
 * The built-in tools this caller may run in this workspace.
 *
 * A tool's availability is its owning block's: the permission-group allowlist,
 * the preview-reveal state, and the deployment allowlist are all expressed
 * against block types, so the catalog derives the tool set from the blocks that
 * survive the gate rather than restating those policies against tool ids.
 *
 * A tool no visible block references is therefore absent, which is also the
 * right answer for the handful of internal tools no block exposes — they are
 * not caller-invokable, so publishing them would advertise an id that cannot be
 * used.
 */
export function resolveVisibleToolIds(gate: CatalogGate): Promise<Set<string>> {
  return withCatalogBlockScope(gate, async () => {
    const toolIds = new Set<string>()
    for (const block of getAllBlocks()) {
      if (!isBlockVisibleToCaller(block, gate)) continue
      for (const toolId of block.tools?.access ?? []) toolIds.add(resolveToolId(toolId))
    }
    return toolIds
  })
}
