export interface StoredToolSchema {
  description?: string
  properties?: Record<string, unknown>
  required?: string[]
  function?: {
    name?: string
    parameters?: {
      properties?: Record<string, unknown>
      required?: string[]
    }
  }
}

/**
 * Represents a tool selected and configured in a workflow tool-input field.
 */
export interface StoredTool {
  type: string
  title?: string
  toolId?: string
  params?: Record<string, string>
  isExpanded?: boolean
  customToolId?: string
  schema?: StoredToolSchema
  code?: string
  operation?: string
  usageControl?: 'auto' | 'force' | 'none'
}

export interface ParsedStoredTool extends Omit<StoredTool, 'params'> {
  params?: Record<string, unknown>
}

export function parseStoredToolInputValue(value: unknown): ParsedStoredTool[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return []
    const record = tool as Record<string, unknown>
    if (typeof record.type !== 'string') return []

    const params =
      record.params && typeof record.params === 'object' && !Array.isArray(record.params)
        ? (record.params as Record<string, unknown>)
        : undefined

    return [
      {
        type: record.type,
        title: typeof record.title === 'string' ? record.title : undefined,
        toolId: typeof record.toolId === 'string' ? record.toolId : undefined,
        operation: typeof record.operation === 'string' ? record.operation : undefined,
        params,
        customToolId: typeof record.customToolId === 'string' ? record.customToolId : undefined,
        code: typeof record.code === 'string' ? record.code : undefined,
        usageControl:
          record.usageControl === 'auto' ||
          record.usageControl === 'force' ||
          record.usageControl === 'none'
            ? record.usageControl
            : undefined,
        isExpanded: typeof record.isExpanded === 'boolean' ? record.isExpanded : undefined,
        schema:
          record.schema && typeof record.schema === 'object' && !Array.isArray(record.schema)
            ? (record.schema as StoredToolSchema)
            : undefined,
      },
    ]
  })
}
