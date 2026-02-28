/**
 * Represents a tool selected and configured in the workflow
 *
 * @remarks
 * Valid types include:
 * - Standard block types (e.g., 'api', 'search', 'function')
 * - 'custom-tool': User-defined tools with custom code
 * - 'mcp': Individual MCP tool from a connected server
 *
 * For custom tools (new format), we only store: type, customToolId, usageControl, isExpanded.
 * Everything else (title, schema, code) is loaded dynamically from the database.
 * Legacy custom tools with inline schema/code are still supported for backwards compatibility.
 */
export interface StoredTool {
  /** Block type identifier */
  type: string
  /** Display title for the tool (optional for new custom tool format) */
  title?: string
  /** Direct tool ID for execution (optional for new custom tool format) */
  toolId?: string
  /** Parameter values configured by the user */
  params?: Record<string, string>
  /** Whether the tool details are expanded in UI */
  isExpanded?: boolean
  /** Database ID for custom tools (new format - reference only) */
  customToolId?: string
  /** Tool schema for custom tools (legacy format - inline JSON schema) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema?: Record<string, any>
  /** Implementation code for custom tools (legacy format - inline) */
  code?: string
  /** Selected operation for multi-operation tools */
  operation?: string
  /** Tool usage control mode for LLM */
  usageControl?: 'auto' | 'force' | 'none'
}
