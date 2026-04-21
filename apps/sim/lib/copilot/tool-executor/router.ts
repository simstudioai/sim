import { TOOL_CATALOG, type ToolCatalogEntry } from '@/lib/copilot/generated/tool-catalog-v1'
import type { ToolCallDescriptor } from './types'

export type ToolRouteTarget = ToolCatalogEntry['route']

export function isToolInCatalog(toolId: string): boolean {
  return toolId in TOOL_CATALOG
}

export function getToolEntry(toolId: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG[toolId]
}

export type ToolRoute = {
  route: ToolRouteTarget
  mode: ToolCatalogEntry['mode']
  subagentId?: string
}

export function routeToolCall(toolId: string): ToolRoute | null {
  const entry = getToolEntry(toolId)
  if (!entry) return null
  return { route: entry.route, mode: entry.mode, subagentId: entry.subagentId }
}

export function isSimExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.route === 'sim'
}

export function isGoExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.route === 'go'
}

export function isKnownTool(toolId: string): boolean {
  return isToolInCatalog(toolId)
}

export interface PartitionedBatch {
  sim: ToolCallDescriptor[]
  go: ToolCallDescriptor[]
  subagent: ToolCallDescriptor[]
  client: ToolCallDescriptor[]
  unknown: ToolCallDescriptor[]
}

export function partitionToolBatch(toolCalls: ToolCallDescriptor[]): PartitionedBatch {
  const result: PartitionedBatch = { sim: [], go: [], subagent: [], client: [], unknown: [] }

  for (const tc of toolCalls) {
    const route = routeToolCall(tc.toolId)
    if (!route) {
      result.unknown.push(tc)
      continue
    }
    result[route.route].push(tc)
  }

  return result
}
