import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkflowValidation')

function isValidCustomToolSchema(tool: any): boolean {
  try {
    if (!tool || typeof tool !== 'object') return false
    if (tool.type !== 'custom-tool') return true // non-custom tools are validated elsewhere

    const schema = tool.schema
    if (!schema || typeof schema !== 'object') return false
    const fn = schema.function
    if (!fn || typeof fn !== 'object') return false
    if (!fn.name || typeof fn.name !== 'string') return false

    const params = fn.parameters
    if (!params || typeof params !== 'object') return false
    if (params.type !== 'object') return false
    if (!params.properties || typeof params.properties !== 'object') return false

    return true
  } catch (_err) {
    return false
  }
}

export function sanitizeAgentToolsInBlocks(
  blocks: Record<string, any>
): { blocks: Record<string, any>; warnings: string[] } {
  const warnings: string[] = []

  // Shallow clone to avoid mutating callers
  const sanitizedBlocks: Record<string, any> = { ...blocks }

  for (const [blockId, block] of Object.entries(sanitizedBlocks)) {
    try {
      if (!block || block.type !== 'agent') continue
      const subBlocks = block.subBlocks || {}
      const toolsSubBlock = subBlocks.tools
      if (!toolsSubBlock) continue

      let value = toolsSubBlock.value

      // Parse legacy string format
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch (_e) {
          warnings.push(`Block ${block.name || blockId}: invalid tools JSON; resetting tools to empty array`)
          value = []
        }
      }

      if (!Array.isArray(value)) {
        // Force to array to keep client safe
        warnings.push(`Block ${block.name || blockId}: tools value is not an array; resetting`)
        toolsSubBlock.value = []
        continue
      }

      const originalLength = value.length
      const cleaned = value
        .filter((tool: any) => {
          // Allow non-custom tools to pass through as-is
          if (!tool || typeof tool !== 'object') return false
          if (tool.type !== 'custom-tool') return true
          const ok = isValidCustomToolSchema(tool)
          if (!ok) {
            logger.warn('Removing invalid custom tool from workflow', {
              blockId,
              blockName: block.name,
            })
          }
          return ok
        })
        .map((tool: any) => {
          if (tool.type === 'custom-tool') {
            // Ensure required defaults to avoid client crashes
            if (!tool.code || typeof tool.code !== 'string') {
              tool.code = ''
            }
            if (!tool.usageControl) {
              tool.usageControl = 'auto'
            }
          }
          return tool
        })

      if (cleaned.length !== originalLength) {
        warnings.push(
          `Block ${block.name || blockId}: removed ${originalLength - cleaned.length} invalid tool(s)`
        )
      }

      toolsSubBlock.value = cleaned
      // Reassign in case caller uses object identity
      sanitizedBlocks[blockId] = { ...block, subBlocks: { ...subBlocks, tools: toolsSubBlock } }
    } catch (err: any) {
      warnings.push(
        `Block ${block?.name || blockId}: tools sanitation failed: ${err?.message || String(err)}`
      )
    }
  }

  return { blocks: sanitizedBlocks, warnings }
} 