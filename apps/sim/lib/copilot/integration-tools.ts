import { getAllBlocks } from '@/blocks/registry'
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
}

let cached: ExposedIntegrationTool[] | null = null

/**
 * Returns the canonical set of integration tools exposed to the copilot agent:
 * the latest version of each operation owned by a visible (non-hideFromToolbar)
 * block.
 *
 * This is the single source of truth shared by VFS discovery
 * (components/integrations/**) and the deferred callable-tool payload, so the
 * agent can call exactly what it can discover — no orphan callable tools, and no
 * version drift between what the VFS shows and what is loadable.
 */
export function getExposedIntegrationTools(): ExposedIntegrationTool[] {
  if (cached) return cached

  // Map the tool ids each visible block exposes (both the raw id and its
  // version-stripped base name) to that block's service directory.
  const toolToService = new Map<string, string>()
  for (const block of getAllBlocks()) {
    if (block.hideFromToolbar) continue
    if (!block.tools?.access) continue
    const service = stripVersionSuffix(block.type)
    for (const toolId of block.tools.access) {
      toolToService.set(toolId, service)
      toolToService.set(stripVersionSuffix(toolId), service)
    }
  }

  const exposed: ExposedIntegrationTool[] = []
  const seen = new Set<string>()
  for (const [toolId, config] of Object.entries(getLatestVersionTools(toolRegistry))) {
    const baseName = stripVersionSuffix(toolId)
    const service = toolToService.get(toolId) ?? toolToService.get(baseName)
    if (!service) continue
    if (seen.has(baseName)) continue
    seen.add(baseName)
    const prefix = `${service}_`
    const operation = baseName.startsWith(prefix) ? baseName.slice(prefix.length) : baseName
    exposed.push({ toolId, config, service, operation })
  }

  cached = exposed
  return exposed
}

/** Test-only: clears the memoized set so registry changes are picked up. */
export function resetExposedIntegrationToolsCache(): void {
  cached = null
}
