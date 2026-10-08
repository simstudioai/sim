import type { ManagedMcpToolSnapshot } from '@sim/db/schema'
import { isPlainRecord } from '@sim/utils/object'
import type { McpTool } from '@/lib/mcp/types'

/** Protocol metadata stays intact when discovery is saved for a managed connection. */
export function snapshotMcpTool(tool: McpTool): ManagedMcpToolSnapshot {
  return {
    name: tool.name,
    inputSchema: tool.inputSchema,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
    ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
  }
}

/** Malformed visibility metadata never expands a tool's audience. */
export function isMcpToolVisible(tool: Pick<McpTool, '_meta'>, audience: 'model' | 'app'): boolean {
  const ui = tool._meta?.ui
  if (!isPlainRecord(ui) || ui.visibility === undefined) return true
  return (
    Array.isArray(ui.visibility) &&
    ui.visibility.every((value) => value === 'model' || value === 'app') &&
    ui.visibility.includes(audience)
  )
}

export function getMcpAppResourceUri(tool: Pick<McpTool, '_meta'>): string | undefined {
  const ui = tool._meta?.ui
  const nested = isPlainRecord(ui) ? ui.resourceUri : undefined
  const uri = nested === undefined ? tool._meta?.['ui/resourceUri'] : nested
  return typeof uri === 'string' && uri.startsWith('ui://') && uri.length <= 2048 ? uri : undefined
}

/** A session App may only reuse the connection and UI template that created its snapshot. */
export function matchesMcpAppOrigin(
  tools: McpTool[],
  origin: { toolName: string; resourceUri: string } | undefined
): boolean {
  return (
    !!origin &&
    tools.some(
      (tool) => tool.name === origin.toolName && getMcpAppResourceUri(tool) === origin.resourceUri
    )
  )
}
