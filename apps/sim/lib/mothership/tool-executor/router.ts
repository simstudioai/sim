import { isCopilotToolPermissionsEnabled } from '@/lib/core/config/env-flags'
import { TOOL_CATALOG, type ToolCatalogEntry } from '@/lib/mothership/generated/tool-catalog-v1'

export function isToolInCatalog(toolId: string): boolean {
  return toolId in TOOL_CATALOG
}

export function getToolEntry(toolId: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG[toolId]
}

export function isSimExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.route === 'sim'
}

export function isClientExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.route === 'client'
}

export function isKnownTool(toolId: string): boolean {
  return isToolInCatalog(toolId)
}

/** Declared in the mothership tool catalog; Go carries the flag but never enforces it. */
export function toolRequiresApproval(toolId: string): boolean {
  return getToolEntry(toolId)?.requiresApproval === true
}

/**
 * Whether a tool may only run on a lane that is able to hold an approval prompt.
 *
 * `toolCallNeedsApproval` answers for the dispatch lane, where a streaming
 * context exists to gate against. The in-band route has neither a context nor a
 * waiter — the mothership executes those calls itself — so it asks this instead,
 * before running anything, and refuses rather than blocks: a background lane
 * must never hang on a prompt with no row behind it.
 *
 * Lives here rather than beside the dispatch gate so that asking the question
 * costs only the catalog. The gate module reaches the permission persistence
 * layer, which opens a pub/sub channel when it loads.
 *
 * Deliberately blind to the stored auto-allow list. Consulting it here would add
 * a database read to every in-band call to reach the same place by a longer
 * route: an auto-allowed tool sent to the checkpoint lane is admitted there
 * without prompting anyone. Refusing unconditionally keeps this fail-closed and
 * leaves the one implementation of "has the user allowed this" on the lane that
 * already owns it.
 */
export function toolRequiresApprovalLane(toolId: string): boolean {
  return isCopilotToolPermissionsEnabled && toolRequiresApproval(toolId)
}
