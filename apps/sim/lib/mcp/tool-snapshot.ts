import type { ManagedMcpToolSnapshot } from '@sim/db/schema'
import type { McpTool } from '@/lib/mcp/types'

/** The persisted view of discovered tools: what a managed connection lists without connecting. */
export function toManagedMcpToolSnapshots(tools: readonly McpTool[]): ManagedMcpToolSnapshot[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  }))
}
