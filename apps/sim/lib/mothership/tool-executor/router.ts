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
