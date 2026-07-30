import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'
import { isHiddenUnder } from '@/blocks/visibility/context'
import { tools as toolRegistry } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

export interface ExposedIntegrationTool {
  /**
   * Full registry tool id — also the agent-callable id and the schema `id`
   * field (e.g. gmail_read_v2). No stripping: discovery, the schema id, and the
   * callable id are all this exact value, matching the block's tools.access.
   */
  toolId: string
  config: ToolConfig
  /** Service directory name, e.g. "gmail". */
  service: string
  /** Operation stem within the service (used for the VFS path filename), e.g. "read". */
  operation: string
  /** Owning block's registry type — the key block-visibility rules gate on. */
  blockType: string
  /** Owning block's static `preview` marker, for the per-viewer filter. */
  preview?: boolean
}

let cached: ExposedIntegrationTool[] | null = null

/**
 * Returns the UNGATED universe of integration tools exposable to the copilot
 * agent: the latest version of each operation owned by a non-`hideFromToolbar`
 * block — INCLUDING unreleased `preview` blocks.
 *
 * Deliberately sourced from the raw `BLOCK_REGISTRY` (never the visibility-
 * projected `getAllBlocks`) so this process-global memo is deterministic and
 * can never be poisoned by whichever viewer's gated projection ran first.
 * Every per-viewer consumer MUST apply {@link filterExposedIntegrationTools}
 * before exposing the set.
 *
 * This is the single source of truth shared by VFS discovery
 * (components/integrations/**) and the deferred callable-tool payload, so the
 * agent can call exactly what it can discover — no orphan callable tools, and no
 * version drift between what the VFS shows and what is loadable.
 */
export function getExposedIntegrationTools(): ExposedIntegrationTool[] {
  if (cached) return cached

  // Map the tool ids each visible block exposes (both the raw id and its
  // version-stripped base name) to that block's service directory + type.
  const toolToBlock = new Map<string, { service: string; blockType: string; preview?: boolean }>()
  for (const block of Object.values(BLOCK_REGISTRY)) {
    if (block.hideFromToolbar) continue
    if (!block.tools?.access) continue
    const service = stripVersionSuffix(block.type)
    const owner = { service, blockType: block.type, preview: block.preview }
    for (const toolId of block.tools.access) {
      for (const key of [toolId, stripVersionSuffix(toolId)]) {
        // A preview block must not steal ownership of tools it shares with a
        // released block (e.g. slack_v2 spreads slack's tools.access), or the
        // per-viewer filter would hide those tools from everyone without the
        // preview reveal.
        const existing = toolToBlock.get(key)
        if (existing && !existing.preview && owner.preview) continue
        toolToBlock.set(key, owner)
      }
    }
  }

  const exposed: ExposedIntegrationTool[] = []
  const seen = new Set<string>()
  for (const [toolId, config] of Object.entries(getLatestVersionTools(toolRegistry))) {
    const baseName = stripVersionSuffix(toolId)
    const owner = toolToBlock.get(toolId) ?? toolToBlock.get(baseName)
    if (!owner) continue
    if (seen.has(baseName)) continue
    seen.add(baseName)
    const prefix = `${owner.service}_`
    const operation = baseName.startsWith(prefix) ? baseName.slice(prefix.length) : baseName
    exposed.push({
      toolId,
      config,
      service: owner.service,
      operation,
      blockType: owner.blockType,
      preview: owner.preview,
    })
  }

  cached = exposed
  return exposed
}

/**
 * Per-viewer projection of the exposed set: drops tools whose owning block is
 * hidden under `vis` (unrevealed preview blocks — including with a null state —
 * and kill-switched types). Apply at every surface that hands the set to a
 * viewer: VFS stamping, the deferred tool payload, `list_integration_tools`.
 */
export function filterExposedIntegrationTools(
  tools: ExposedIntegrationTool[],
  vis: BlockVisibilityState | null
): ExposedIntegrationTool[] {
  return tools.filter(
    (tool) => !isHiddenUnder(vis, { type: tool.blockType, preview: tool.preview })
  )
}

/** Test-only: clears the memoized set so registry changes are picked up. */
export function resetExposedIntegrationToolsCache(): void {
  cached = null
}
