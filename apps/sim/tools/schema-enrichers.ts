import { createLogger } from '@sim/logger'
import { enrichTableToolDescription, enrichTableToolParameters } from '@/lib/table/llm/enrichment'
import type { TableSummary } from '@/lib/table/types'

const logger = createLogger('SchemaEnrichers')

async function fetchTableSchema(tableId: string): Promise<TableSummary | null> {
  try {
    const { buildAuthHeaders, buildAPIUrl } = await import('@/executor/utils/http')

    const headers = await buildAuthHeaders()
    const url = buildAPIUrl(`/api/table/${tableId}/schema`)

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      logger.warn(`Failed to fetch table schema for ${tableId}: ${response.status}`)
      return null
    }

    const result = await response.json()
    const data = result.data || result

    return {
      name: data.name || 'Table',
      columns: data.columns || [],
    }
  } catch (error) {
    logger.error('Failed to fetch table schema:', error)
    return null
  }
}

export async function enrichTableToolSchema(
  tableId: string,
  toolId: string,
  originalSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  },
  originalDescription: string
): Promise<{
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
} | null> {
  const tableSchema = await fetchTableSchema(tableId)

  if (!tableSchema) {
    return null
  }

  const enrichedDescription = enrichTableToolDescription(originalDescription, tableSchema, toolId)
  const enrichedParams = enrichTableToolParameters(
    { properties: originalSchema.properties, required: originalSchema.required },
    tableSchema,
    toolId
  )

  return {
    description: enrichedDescription,
    parameters: {
      type: 'object',
      properties: enrichedParams.properties,
      required:
        enrichedParams.required.length > 0 ? enrichedParams.required : originalSchema.required,
    },
  }
}

interface TagDefinition {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
}

/**
 * Maps KB field types to JSON schema types
 */
function mapFieldTypeToSchemaType(fieldType: string): string {
  switch (fieldType) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Fetches tag definitions from knowledge base
 */
async function fetchTagDefinitions(knowledgeBaseId: string): Promise<TagDefinition[]> {
  try {
    const { buildAuthHeaders, buildAPIUrl } = await import('@/executor/utils/http')

    const headers = await buildAuthHeaders()
    const url = buildAPIUrl(`/api/knowledge/${knowledgeBaseId}/tag-definitions`)

    logger.info(`Fetching tag definitions for KB ${knowledgeBaseId} from ${url.toString()}`)

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      logger.warn(`Failed to fetch tag definitions for KB ${knowledgeBaseId}: ${response.status}`)
      return []
    }

    const result = await response.json()
    const tagDefinitions = result.data || []
    logger.info(`Found ${tagDefinitions.length} tag definitions for KB ${knowledgeBaseId}`)
    return tagDefinitions
  } catch (error) {
    logger.error('Failed to fetch tag definitions:', error)
    return []
  }
}

/**
 * Fetches KB tag definitions and builds a schema for LLM consumption.
 * Returns an object schema where each property is a tag the LLM can set.
 */
export async function enrichKBTagsSchema(knowledgeBaseId: string): Promise<{
  type: string
  properties?: Record<string, { type: string; description?: string }>
  description?: string
  required?: string[]
} | null> {
  const tagDefinitions = await fetchTagDefinitions(knowledgeBaseId)

  if (tagDefinitions.length === 0) {
    return null
  }

  const properties: Record<string, { type: string; description?: string }> = {}
  const tagDescriptions: string[] = []

  for (const def of tagDefinitions) {
    const schemaType = mapFieldTypeToSchemaType(def.fieldType)

    properties[def.displayName] = {
      type: schemaType,
      description: `${def.fieldType} tag`,
    }
    tagDescriptions.push(`${def.displayName} (${def.fieldType})`)
  }

  return {
    type: 'object',
    properties,
    description: `Document tags. Available tags: ${tagDescriptions.join(', ')}`,
  }
}

/**
 * Fetches KB tag definitions and builds a schema for tag filters.
 * Returns an array schema where each item is a filter with tagName and tagValue.
 */
export async function enrichKBTagFiltersSchema(knowledgeBaseId: string): Promise<{
  type: string
  items?: Record<string, unknown>
  description?: string
} | null> {
  const tagDefinitions = await fetchTagDefinitions(knowledgeBaseId)

  if (tagDefinitions.length === 0) {
    return null
  }

  const tagDescriptions = tagDefinitions.map((def) => `${def.displayName} (${def.fieldType})`)

  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        tagName: {
          type: 'string',
          description: `Name of the tag to filter by. Available: ${tagDescriptions.join(', ')}`,
        },
        tagValue: {
          type: 'string',
          description: 'Value to filter by',
        },
      },
      required: ['tagName', 'tagValue'],
    },
    description: `Tag filters for search. Available tags: ${tagDescriptions.join(', ')}`,
  }
}
