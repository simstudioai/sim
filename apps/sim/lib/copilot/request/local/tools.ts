import type { ToolSchema } from '@/lib/copilot/chat/payload'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import type { ProviderToolConfig } from '@/providers/types'

type JsonSchema = {
  type: string
  properties: Record<string, unknown>
  required: string[]
}

const MOTHERSHIP_ONLY_TOOLS = new Set(['load_integration_tool'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeSchema(value: unknown): JsonSchema {
  const schema = asRecord(value)
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []

  return {
    type: typeof schema.type === 'string' ? schema.type : 'object',
    properties: asRecord(schema.properties),
    required,
  }
}

function describeWorkspaceTool(name: string, schema: JsonSchema): string {
  const propertyDescriptions = Object.values(schema.properties)
    .map((property) => asRecord(property).description)
    .filter((description): description is string => typeof description === 'string')
    .slice(0, 2)

  const detail = propertyDescriptions.length > 0 ? ` ${propertyDescriptions.join(' ')}` : ''
  return `Operate on the current Sim workspace with ${name}.${detail}`
}

function fromDynamicSchema(tool: ToolSchema): ProviderToolConfig {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    params: tool.params ?? {},
    parameters: normalizeSchema(tool.input_schema),
  }
}

function readDynamicTools(value: unknown, includeDeferred: boolean): ToolSchema[] {
  if (!Array.isArray(value)) return []

  return value.filter((tool): tool is ToolSchema => {
    if (!tool || typeof tool !== 'object') return false
    const candidate = tool as Record<string, unknown>
    const isValid =
      typeof candidate.name === 'string' &&
      typeof candidate.description === 'string' &&
      candidate.input_schema !== null &&
      typeof candidate.input_schema === 'object'
    return isValid && (includeDeferred || candidate.defer_loading !== true)
  })
}

/** Build the tool surface available to the local workspace agent. */
export function buildLocalWorkspaceTools(
  requestPayload: Record<string, unknown>
): ProviderToolConfig[] {
  const tools = new Map<string, ProviderToolConfig>()

  for (const entry of Object.values(TOOL_CATALOG)) {
    if (entry.route !== 'sim' || entry.internal || MOTHERSHIP_ONLY_TOOLS.has(entry.id)) continue

    const parameters = normalizeSchema(entry.parameters)
    tools.set(entry.id, {
      id: entry.id,
      name: entry.name,
      description: describeWorkspaceTool(entry.name, parameters),
      params: {},
      parameters,
    })
  }

  const dynamicTools = [
    ...readDynamicTools(requestPayload.integrationTools, false),
    ...readDynamicTools(requestPayload.mothershipTools, true),
  ]
  for (const tool of dynamicTools) {
    if (!tools.has(tool.name)) tools.set(tool.name, fromDynamicSchema(tool))
  }

  return [...tools.values()]
}
