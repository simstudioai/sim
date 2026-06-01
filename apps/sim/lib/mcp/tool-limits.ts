import { workflowMcpTool } from '@sim/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  MAX_MCP_PARAMETER_SCHEMA_BYTES,
  MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES,
  MAX_MCP_SERVER_TOOLS_METADATA_BYTES,
  MAX_MCP_TOOL_DESCRIPTION_BYTES,
  MAX_MCP_TOOL_NAME_BYTES,
} from '@/lib/mcp/constants'

function utf8Size(value: string): number {
  return Buffer.byteLength(value, 'utf-8')
}

function jsonSize(value: unknown): number | null {
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? utf8Size(json) : null
  } catch {
    return null
  }
}

export interface McpToolMetadataSizes {
  toolNameBytes: number
  toolDescriptionBytes: number
  parameterSchemaBytes: number
}

export interface McpToolMetadataUsage {
  schemaBytes: number
  metadataBytes: number
}

export interface McpToolMetadataUsageRow extends McpToolMetadataSizes {
  id: string
}

export function getMcpToolMetadataSizes(metadata: {
  toolName?: string | null
  toolDescription?: string | null
  parameterSchema?: unknown
}): McpToolMetadataSizes {
  return {
    toolNameBytes: metadata.toolName ? utf8Size(metadata.toolName) : 0,
    toolDescriptionBytes: metadata.toolDescription ? utf8Size(metadata.toolDescription) : 0,
    parameterSchemaBytes:
      metadata.parameterSchema !== undefined
        ? (jsonSize(metadata.parameterSchema) ?? MAX_MCP_PARAMETER_SCHEMA_BYTES + 1)
        : 0,
  }
}

export function addMcpToolMetadataUsage(
  usage: McpToolMetadataUsage,
  tool: {
    toolName?: string | null
    toolDescription?: string | null
    parameterSchema?: unknown
  }
): McpToolMetadataUsage {
  const sizes = getMcpToolMetadataSizes(tool)
  return {
    schemaBytes: usage.schemaBytes + sizes.parameterSchemaBytes,
    metadataBytes:
      usage.metadataBytes +
      sizes.toolNameBytes +
      sizes.toolDescriptionBytes +
      sizes.parameterSchemaBytes,
  }
}

export function addMcpToolMetadataUsageRow(
  usage: McpToolMetadataUsage,
  row: McpToolMetadataUsageRow
): McpToolMetadataUsage {
  return {
    schemaBytes: usage.schemaBytes + row.parameterSchemaBytes,
    metadataBytes:
      usage.metadataBytes + row.toolNameBytes + row.toolDescriptionBytes + row.parameterSchemaBytes,
  }
}

export function subtractMcpToolMetadataUsageRow(
  usage: McpToolMetadataUsage,
  row?: McpToolMetadataUsageRow
): McpToolMetadataUsage {
  if (!row) return usage
  return {
    schemaBytes: usage.schemaBytes - row.parameterSchemaBytes,
    metadataBytes:
      usage.metadataBytes - row.toolNameBytes - row.toolDescriptionBytes - row.parameterSchemaBytes,
  }
}

export function getMcpToolMetadataUsageFromRows(
  rows: McpToolMetadataUsageRow[]
): McpToolMetadataUsage {
  return rows.reduce(addMcpToolMetadataUsageRow, { schemaBytes: 0, metadataBytes: 0 })
}

export function createMcpToolMetadataUsageRow(tool: {
  id: string
  toolName: string
  toolDescription: string | null
  parameterSchema: unknown
}): McpToolMetadataUsageRow {
  return { id: tool.id, ...getMcpToolMetadataSizes(tool) }
}

export function validateMcpServerToolMetadataBudget(usage: McpToolMetadataUsage): string | null {
  if (usage.schemaBytes > MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES) {
    return `MCP server tool schemas exceed maximum size of ${MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES} bytes`
  }
  if (usage.metadataBytes > MAX_MCP_SERVER_TOOLS_METADATA_BYTES) {
    return `MCP server tool metadata exceeds maximum size of ${MAX_MCP_SERVER_TOOLS_METADATA_BYTES} bytes`
  }
  return null
}

export function exceedsMcpServerToolMetadataBudget(
  usage: McpToolMetadataUsage,
  tool: { toolName: string; toolDescription: string | null; parameterSchema: unknown }
): boolean {
  return validateMcpServerToolMetadataBudget(addMcpToolMetadataUsage(usage, tool)) !== null
}

export async function getMcpServerToolMetadataUsageRows(
  tx: DbOrTx,
  serverId: string,
  excludeToolId?: string
): Promise<McpToolMetadataUsageRow[]> {
  const rows = await tx
    .select({
      id: workflowMcpTool.id,
      toolNameBytes: sql<number>`octet_length(${workflowMcpTool.toolName})`,
      toolDescriptionBytes: sql<number>`coalesce(octet_length(${workflowMcpTool.toolDescription}), 0)`,
      parameterSchemaBytes: sql<number>`octet_length(${workflowMcpTool.parameterSchema}::text)`,
    })
    .from(workflowMcpTool)
    .where(
      and(
        eq(workflowMcpTool.serverId, serverId),
        isNull(workflowMcpTool.archivedAt),
        excludeToolId ? ne(workflowMcpTool.id, excludeToolId) : undefined
      )
    )

  return rows.map((row) => ({
    id: row.id,
    toolNameBytes: Number(row.toolNameBytes) || 0,
    toolDescriptionBytes: Number(row.toolDescriptionBytes) || 0,
    parameterSchemaBytes: Number(row.parameterSchemaBytes) || 0,
  }))
}

export function getMcpToolDescriptionForStorage(
  description: string | null | undefined,
  workflowName: string
): string {
  const trimmed = description?.trim()
  if (trimmed && utf8Size(trimmed) <= MAX_MCP_TOOL_DESCRIPTION_BYTES) {
    return trimmed
  }
  return `Execute ${workflowName} workflow`
}

export function validateMcpToolMetadataForStorage(metadata: {
  toolName?: string | null
  toolDescription?: string | null
  parameterSchema?: unknown
}): string | null {
  if (metadata.toolName && utf8Size(metadata.toolName) > MAX_MCP_TOOL_NAME_BYTES) {
    return `Tool name exceeds maximum size of ${MAX_MCP_TOOL_NAME_BYTES} bytes`
  }

  if (
    metadata.toolDescription &&
    utf8Size(metadata.toolDescription) > MAX_MCP_TOOL_DESCRIPTION_BYTES
  ) {
    return `Tool description exceeds maximum size of ${MAX_MCP_TOOL_DESCRIPTION_BYTES} bytes`
  }

  if (metadata.parameterSchema !== undefined) {
    const parameterSchemaBytes = jsonSize(metadata.parameterSchema)
    if (parameterSchemaBytes === null) {
      return 'Tool parameter schema must be JSON serializable'
    }
    if (parameterSchemaBytes > MAX_MCP_PARAMETER_SCHEMA_BYTES) {
      return `Tool parameter schema exceeds maximum size of ${MAX_MCP_PARAMETER_SCHEMA_BYTES} bytes`
    }
  }

  return null
}
