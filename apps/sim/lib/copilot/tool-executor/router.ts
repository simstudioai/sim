import {
  getToolEntry,
  isToolInCatalog,
  type ToolCatalogEntry,
  type ToolExecutor,
} from '@/lib/copilot/tool-catalog'
import type { ToolCallDescriptor } from './types'

export type ToolRoute = {
  executor: ToolExecutor
  mode: ToolCatalogEntry['mode']
  subagentId?: string
}

export function routeToolCall(toolId: string): ToolRoute | null {
  const entry = getToolEntry(toolId)
  if (!entry) return null
  return { executor: entry.executor, mode: entry.mode, subagentId: entry.subagentId }
}

export function isSimExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.executor === 'sim'
}

export function isGoExecuted(toolId: string): boolean {
  return getToolEntry(toolId)?.executor === 'go'
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
    result[route.executor].push(tc)
  }

  return result
}
