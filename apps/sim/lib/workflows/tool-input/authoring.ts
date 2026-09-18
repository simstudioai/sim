import { isPlainRecord, omit } from '@sim/utils/object'
import { isEqual } from 'es-toolkit'
import { z } from 'zod'
import {
  MAX_AGENT_TOOLS_PER_BLOCK,
  v2AgentCustomToolSchema,
  v2AgentIntegrationToolSchema,
  v2AgentMcpServerAdvancedSchema,
  v2AgentMcpToolSchema,
} from '@/lib/api/contracts/v2/workflows'

/** Attachment identity comes from its definition, never an author-supplied alias. */
const identityFields = ['title', 'name', 'toolId', 'functionName'] as const
const noIdentityOverrides = {
  title: z.never().optional(),
  name: z.never().optional(),
  toolId: z.never().optional(),
  functionName: z.never().optional(),
}

const integration = v2AgentIntegrationToolSchema.extend(noIdentityOverrides)
const customReference = v2AgentCustomToolSchema.options[0].extend({
  ...noIdentityOverrides,
  params: z
    .never()
    .optional()
    .describe('Saved custom-tool references do not retain fixed arguments.'),
})
const inlineCustom = v2AgentCustomToolSchema.options[1].extend({
  ...noIdentityOverrides,
  title: z.string().min(1).describe('Inline definition name. Must equal schema.function.name.'),
  params: v2AgentIntegrationToolSchema.shape.params,
})
const mcp = v2AgentMcpToolSchema.extend(noIdentityOverrides)
const mcpServer = v2AgentMcpServerAdvancedSchema.extend(noIdentityOverrides)

const agentTools = z
  .array(z.union([integration, customReference, inlineCustom, mcp, mcpServer]))
  .max(MAX_AGENT_TOOLS_PER_BLOCK)
const mothershipControls = {
  usageControl: z.enum(['auto', 'none']).optional(),
  usageControlExpression: z.never().optional(),
}
const mothershipTools = z
  .array(
    z.union([
      mcp.extend({
        ...mothershipControls,
        params: v2AgentMcpToolSchema.shape.params.def.left
          .pick({ serverId: true, toolName: true })
          .strict()
          .describe(
            'MCP identity only. Sim Chat discovers arguments at call time; fixed arguments are not supported.'
          ),
      }),
      mcpServer.extend(mothershipControls),
    ])
  )
  .max(MAX_AGENT_TOOLS_PER_BLOCK)

/** Internal authoring narrows the existing write shapes; stored workflows keep their runtime. */
export function getToolBindingAuthoringSchema(blockType: string) {
  if (blockType === 'agent') return agentTools
  if (blockType === 'mothership') return mothershipTools
  return undefined
}

function bindingIdentity(tool: Record<string, unknown>): unknown[] {
  const params = isPlainRecord(tool.params) ? tool.params : {}
  return [tool.type, tool.operation, tool.customToolId, params.serverId, params.toolName]
}

/** Preserve saved labels on the same binding, including when the author reorders the array. */
export function validateToolBindingAuthoring(
  blockType: string,
  value: unknown,
  previousValue?: unknown
): string | undefined {
  const schema = getToolBindingAuthoringSchema(blockType)
  if (!schema || !Array.isArray(value)) return undefined
  const previous = Array.isArray(previousValue) ? previousValue.filter(isPlainRecord) : []
  const remaining = [...previous]

  for (const [index, tool] of value.entries()) {
    if (!isPlainRecord(tool)) continue
    const sameIndex = remaining.findIndex((saved) =>
      isEqual(omit(saved, ['isExpanded']), omit(tool, ['isExpanded']))
    )
    if (sameIndex !== -1) {
      remaining.splice(sameIndex, 1)
      continue
    }
    const savedIndex = remaining.findIndex(
      (saved) =>
        isEqual(bindingIdentity(saved), bindingIdentity(tool)) &&
        identityFields.every((key) => tool[key] === undefined || tool[key] === saved[key])
    )
    const saved = savedIndex === -1 ? undefined : remaining.splice(savedIndex, 1)[0]
    const isInline = tool.type === 'custom-tool' && !tool.customToolId
    const carried = identityFields.filter(
      (key) => saved && tool[key] === saved[key] && !(isInline && key === 'title')
    )
    const candidate = omit(tool, carried)
    if (
      identityFields.some((key) => candidate[key] !== undefined && !(isInline && key === 'title'))
    ) {
      return `tools[${index}]: attachment names are read-only. Omit title, name, toolId and functionName; use the catalog operation, saved customToolId, or MCP params.toolName. Existing labels may be preserved unchanged.`
    }
    if (
      isInline &&
      isPlainRecord(tool.schema) &&
      isPlainRecord(tool.schema.function) &&
      tool.title !== tool.schema.function.name &&
      !(
        saved &&
        saved.title === tool.title &&
        isPlainRecord(saved.schema) &&
        isPlainRecord(saved.schema.function) &&
        saved.schema.function.name === tool.schema.function.name
      )
    ) {
      return `tools[${index}]: an inline custom tool defines a new tool; title must equal schema.function.name. For a saved tool, supply customToolId without a name override.`
    }
    const parsed = schema.element.safeParse(candidate)
    if (!parsed.success) {
      return blockType === 'mothership'
        ? `tools[${index}]: Sim Chat accepts MCP tool or MCP server bindings only, with auto/none mode and no fixed arguments. Read blocks get mothership for the exact tools valueSchema; selections supplement integration access, not an allowlist.`
        : `tools[${index}]: invalid tool binding. Read blocks get agent for the tools valueSchema. ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
    }
  }
  if (value.length > MAX_AGENT_TOOLS_PER_BLOCK)
    return `Tools cannot exceed ${MAX_AGENT_TOOLS_PER_BLOCK} entries.`
  return undefined
}
