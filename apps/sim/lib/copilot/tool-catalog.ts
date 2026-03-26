import { TOOL_CATALOG, type ToolCatalogEntry } from '@/lib/copilot/generated/tool-catalog-v1'

export { TOOL_CATALOG, type ToolCatalogEntry }

export type ToolExecutor = ToolCatalogEntry['executor']
export type ToolMode = ToolCatalogEntry['mode']

export function isToolInCatalog(toolId: string): boolean {
  return toolId in TOOL_CATALOG
}

export function getToolEntry(toolId: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG[toolId]
}

export function getToolExecutor(toolId: string): ToolExecutor | undefined {
  return TOOL_CATALOG[toolId]?.executor
}

export function isClientExecutableTool(toolId: string): boolean {
  return TOOL_CATALOG[toolId]?.clientExecutable === true
}

export function isInternalTool(toolId: string): boolean {
  return TOOL_CATALOG[toolId]?.internal === true
}

export function isHiddenTool(toolId: string): boolean {
  return TOOL_CATALOG[toolId]?.hidden === true
}
