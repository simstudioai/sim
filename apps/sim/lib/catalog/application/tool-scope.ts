import {
  type CatalogGate,
  isBlockVisibleToCaller,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import { getAllBlocks } from '@/blocks/registry'
import { resolveToolId } from '@/tools/tool-ids'

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
