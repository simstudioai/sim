import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { McpTool, McpToolResult, McpToolSchema, McpToolSchemaProperty } from '@/lib/mcp/types'
import type { McpExecutionContext, McpMiddleware, McpMiddlewareNext } from './types'

const logger = createLogger('mcp:schema-validator')

export type ToolProvider = (toolName: string) => McpTool | undefined | Promise<McpTool | undefined>

export class SchemaValidatorMiddleware implements McpMiddleware {
  private schemaCache = new Map<string, z.ZodTypeAny>()
  private toolProvider?: ToolProvider

  constructor(options?: { toolProvider?: ToolProvider }) {
    this.toolProvider = options?.toolProvider
  }

  /**
   * Cache a tool's schema explicitly (e.g. during server discovery)
   */
  cacheTool(tool: McpTool) {
    if (!this.schemaCache.has(tool.name)) {
      const zodSchema = this.compileSchema(tool.inputSchema)
      this.schemaCache.set(tool.name, zodSchema)
    }
  }

  /**
   * Clear caches, either for a specific tool or globally.
   */
  clearCache(toolName?: string) {
    if (toolName) {
      this.schemaCache.delete(toolName)
    } else {
      this.schemaCache.clear()
    }
  }

  async execute(context: McpExecutionContext, next: McpMiddlewareNext): Promise<McpToolResult> {
    const { toolCall } = context
    const toolName = toolCall.name

    let zodSchema = this.schemaCache.get(toolName)

    if (!zodSchema && this.toolProvider) {
      const tool = await this.toolProvider(toolName)
      if (tool) {
        zodSchema = this.compileSchema(tool.inputSchema)
        this.schemaCache.set(toolName, zodSchema)
      }
    }

    if (zodSchema) {
      const parseResult = await zodSchema.safeParseAsync(toolCall.arguments)
      if (!parseResult.success) {
        // Return natively formatted error payload
        const errorDetails = parseResult.error.errors
          .map((e) => `${e.path.join('.') || 'root'}: ${e.message}`)
          .join(', ')

        logger.warn('Schema validation failed', { toolName, error: errorDetails })

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Schema validation failed: [${errorDetails}]`,
            },
          ],
        }
      }

      // Sync successfully parsed / defaulted arguments back to context
      context.toolCall.arguments = parseResult.data
    }

    return next(context)
  }

  private compileSchema(schema: McpToolSchema): z.ZodObject<any> {
    return this.compileObject(schema.properties || {}, schema.required || []) as z.ZodObject<any>
  }

  private compileObject(
    properties: Record<string, McpToolSchemaProperty>,
    required: string[]
  ): z.ZodTypeAny {
    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, prop] of Object.entries(properties)) {
      let zodType = this.compileProperty(prop)

      if (!required.includes(key)) {
        zodType = zodType.optional()
      }

      shape[key] = zodType
    }

    return z.object(shape)
  }

  private compileProperty(prop: McpToolSchemaProperty): z.ZodTypeAny {
    let baseType: z.ZodTypeAny = z.any()

    switch (prop.type) {
      case 'string':
        baseType = z.string()
        break
      case 'number':
      case 'integer':
        baseType = z.number()
        break
      case 'boolean':
        baseType = z.boolean()
        break
      case 'array':
        if (prop.items) {
          baseType = z.array(this.compileProperty(prop.items))
        } else {
          baseType = z.array(z.any())
        }
        break
      case 'object':
        baseType = this.compileObject(prop.properties || {}, prop.required || [])
        break
    }

    // Apply Enum mappings
    if (prop.enum && prop.enum.length > 0) {
      if (prop.enum.length === 1) {
        baseType = z.literal(prop.enum[0])
      } else {
        // We use mapped literals injected into an array
        const literals = prop.enum.map((e) => z.literal(e))
        baseType = z.union(literals as any)
      }
    }

    if (prop.description) {
      baseType = baseType.describe(prop.description)
    }

    if (prop.default !== undefined) {
      baseType = baseType.default(prop.default)
    }

    return baseType
  }
}
