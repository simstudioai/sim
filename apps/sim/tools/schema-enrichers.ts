import { createLogger } from '@sim/logger'
import { enrichTableToolDescription, enrichTableToolParameters } from '@/lib/table/llm/enrichment'
import type { TableSummary } from '@/lib/table/types'
import type { WorkflowToolExecutionContext } from '@/tools/types'

const logger = createLogger('SchemaEnrichers')

/** Reads a table schema through the authorized table application operation. */
async function fetchTableSchema(
  tableId: string,
  context: WorkflowToolExecutionContext
): Promise<TableSummary> {
  if (!context.workflowId) {
    throw new Error(`Workflow ID is required to enrich table tool schema for ${tableId}`)
  }
  if (!context.executorDelegationOrigin) {
    throw new Error(`Execution authority is required to enrich table tool schema for ${tableId}`)
  }

  const { readTableSchemaAsExecutor } = await import('@/lib/internal/table/read-schema')
  return readTableSchemaAsExecutor({
    tableId,
    context: {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      executionId: context.executionId,
      userId: context.userId,
      executorDelegationOrigin: context.executorDelegationOrigin,
    },
  })
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

/** Reads tag definitions through the authorized knowledge application operation. */
async function fetchTagDefinitions(
  knowledgeBaseId: string,
  context: WorkflowToolExecutionContext
): Promise<TagDefinition[]> {
  if (!context.executorDelegationOrigin) {
    logger.warn(
      `Skipping tag definition enrichment for KB ${knowledgeBaseId}: no execution authority`
    )
    return []
  }
  if (!context.workflowId) {
    logger.warn(`Skipping tag definition enrichment for KB ${knowledgeBaseId}: no acting workflow`)
    return []
  }
  if (!context.workspaceId) {
    logger.warn(`Skipping tag definition enrichment for KB ${knowledgeBaseId}: no workspace`)
    return []
  }

  try {
    const { listKnowledgeTagsAsExecutor } = await import('@/lib/internal/knowledge/list-tags')
    const tagDefinitions = await listKnowledgeTagsAsExecutor({
      knowledgeBaseId,
      workspaceId: context.workspaceId,
      context: {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        executionId: context.executionId,
        userId: context.userId,
        executorDelegationOrigin: context.executorDelegationOrigin,
      },
    })
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
