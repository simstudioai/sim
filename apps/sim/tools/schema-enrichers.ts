import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { isColumnType } from '@/lib/table/column-types'
import { enrichTableToolDescription, enrichTableToolParameters } from '@/lib/table/llm/enrichment'
import type { TableSummary } from '@/lib/table/types'
import type { WorkflowToolExecutionContext } from '@/tools/types'

const logger = createLogger('SchemaEnrichers')

async function fetchTableSchema(
  tableId: string,
  context: WorkflowToolExecutionContext
): Promise<TableSummary> {
  if (!context.workspaceId) {
    throw new Error(`Workspace ID is required to enrich table tool schema for ${tableId}`)
  }
  if (!context.userId) {
    throw new Error(`User ID is required to enrich table tool schema for ${tableId}`)
  }

  const { buildAuthHeaders, buildAPIUrl, extractAPIErrorMessage } = await import(
    '@/executor/utils/http'
  )

  const headers = await buildAuthHeaders(context.userId)
  const url = buildAPIUrl(`/api/table/${tableId}`, { workspaceId: context.workspaceId })
  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    const message = await extractAPIErrorMessage(response)
    throw new Error(`Failed to fetch table schema for ${tableId}: ${message}`)
  }

  const result: unknown = await response.json()
  if (!isRecordLike(result) || !isRecordLike(result.data) || !isRecordLike(result.data.table)) {
    throw new Error(`Invalid table response while enriching schema for ${tableId}`)
  }

  const table = result.data.table
  if (typeof table.name !== 'string' || !isRecordLike(table.schema)) {
    throw new Error(`Invalid table metadata while enriching schema for ${tableId}`)
  }
  if (!Array.isArray(table.schema.columns)) {
    throw new Error(`Invalid table columns while enriching schema for ${tableId}`)
  }

  const columns = table.schema.columns.map((column, index) => {
    if (!isRecordLike(column) || typeof column.name !== 'string' || !isColumnType(column.type)) {
      throw new Error(`Invalid table column ${index} while enriching schema for ${tableId}`)
    }
    return { name: column.name, type: column.type }
  })

  return { name: table.name, columns }
}

export async function enrichTableToolSchema(
  tableId: string,
  toolId: string,
  originalSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  },
  originalDescription: string,
  context: WorkflowToolExecutionContext
): Promise<{
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}> {
  const tableSchema = await fetchTableSchema(tableId, context)

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
 * Fetches tag definitions from a knowledge base as the acting user, whose id the
 * route requires to authorize the read.
 */
async function fetchTagDefinitions(
  knowledgeBaseId: string,
  context: WorkflowToolExecutionContext
): Promise<TagDefinition[]> {
  if (!context.userId) {
    logger.warn(`Skipping tag definition enrichment for KB ${knowledgeBaseId}: no acting user`)
    return []
  }

  try {
    const { buildAuthHeaders, buildAPIUrl } = await import('@/executor/utils/http')

    const headers = await buildAuthHeaders(context.userId)
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
export async function enrichKBTagsSchema(
  knowledgeBaseId: string,
  context: WorkflowToolExecutionContext
): Promise<{
  type: string
  properties?: Record<string, { type: string; description?: string }>
  description?: string
  required?: string[]
} | null> {
  const tagDefinitions = await fetchTagDefinitions(knowledgeBaseId, context)

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
export async function enrichKBTagFiltersSchema(
  knowledgeBaseId: string,
  context: WorkflowToolExecutionContext
): Promise<{
  type: string
  items?: Record<string, unknown>
  description?: string
} | null> {
  const tagDefinitions = await fetchTagDefinitions(knowledgeBaseId, context)

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
