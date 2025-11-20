'use client'

import { useMemo } from 'react'
import { extractFieldsFromSchema } from '@/lib/response-format'
import { getBlockOutputPaths, getBlockOutputs } from '@/lib/workflows/block-outputs'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers'
import type { SchemaField } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/connection-blocks/components/field-item/field-item'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTool } from '@/tools/utils'

const RESERVED_KEYS = new Set(['type', 'description'])

/**
 * Checks if a property is an object type
 */
const isObject = (prop: any): boolean => prop && typeof prop === 'object'

/**
 * Gets a subblock value from the store
 */
const getSubBlockValue = (blockId: string, property: string): any => {
  return useSubBlockStore.getState().getValue(blockId, property)
}

/**
 * Generates output paths for a tool-based block
 */
const generateToolOutputPaths = (blockConfig: BlockConfig, operation: string): string[] => {
  if (!blockConfig?.tools?.config?.tool) return []

  try {
    const toolId = blockConfig.tools.config.tool({ operation })
    if (!toolId) return []

    const toolConfig = getTool(toolId)
    if (!toolConfig?.outputs) return []

    return generateOutputPaths(toolConfig.outputs)
  } catch {
    return []
  }
}

/**
 * Recursively generates all output paths from an outputs schema
 */
const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
  const paths: string[] = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      paths.push(currentPath)
    } else if (typeof value === 'object' && value !== null) {
      if ('type' in value && typeof value.type === 'string') {
        paths.push(currentPath)
        // Handle nested objects and arrays
        if (value.type === 'object' && value.properties) {
          paths.push(...generateOutputPaths(value.properties, currentPath))
        } else if (value.type === 'array' && value.items?.properties) {
          paths.push(...generateOutputPaths(value.items.properties, currentPath))
        } else if (
          value.type === 'array' &&
          value.items &&
          typeof value.items === 'object' &&
          !('type' in value.items)
        ) {
          paths.push(...generateOutputPaths(value.items, currentPath))
        }
      } else {
        const subPaths = generateOutputPaths(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      paths.push(currentPath)
    }
  }

  return paths
}

/**
 * Extracts nested fields from array or object properties
 */
const extractChildFields = (prop: any): SchemaField[] | undefined => {
  if (!isObject(prop)) return undefined

  if (prop.properties && isObject(prop.properties)) {
    return extractNestedFields(prop.properties)
  }

  if (prop.items?.properties && isObject(prop.items.properties)) {
    return extractNestedFields(prop.items.properties)
  }

  if (!('type' in prop)) {
    return extractNestedFields(prop)
  }

  if (prop.type === 'array') {
    const itemDefs = Object.fromEntries(
      Object.entries(prop).filter(([key]) => !RESERVED_KEYS.has(key))
    )
    if (Object.keys(itemDefs).length > 0) {
      return extractNestedFields(itemDefs)
    }
  }

  return undefined
}

/**
 * Recursively extracts nested fields from output properties
 */
const extractNestedFields = (properties: Record<string, any>): SchemaField[] => {
  return Object.entries(properties).map(([name, prop]) => {
    const baseType = isObject(prop) && typeof prop.type === 'string' ? prop.type : 'string'
    const type = isObject(prop) && !('type' in prop) ? 'object' : baseType

    return {
      name,
      type,
      description: isObject(prop) ? prop.description : undefined,
      children: extractChildFields(prop),
    }
  })
}

/**
 * Creates a schema field from an output definition
 */
const createFieldFromOutput = (
  name: string,
  output: any,
  responseFormatFields?: SchemaField[]
): SchemaField => {
  const hasExplicitType = isObject(output) && typeof output.type === 'string'
  const type = hasExplicitType ? output.type : isObject(output) ? 'object' : 'string'

  const field: SchemaField = {
    name,
    type,
    description: isObject(output) && 'description' in output ? output.description : undefined,
  }

  if (name === 'data' && responseFormatFields && responseFormatFields.length > 0) {
    field.children = responseFormatFields
  } else {
    field.children = extractChildFields(output)
  }

  return field
}

/**
 * Gets tool outputs for a block's operation
 */
const getToolOutputs = (
  blockConfig: BlockConfig | null,
  operation?: string
): Record<string, any> => {
  if (!blockConfig?.tools?.config?.tool || !operation) return {}

  try {
    const toolId = blockConfig.tools.config.tool({ operation })
    if (!toolId) return {}

    const toolConfig = getTool(toolId)
    return toolConfig?.outputs || {}
  } catch {
    return {}
  }
}

interface UseBlockOutputFieldsParams {
  blockId: string
  blockType: string
  mergedSubBlocks?: Record<string, any>
  responseFormat?: any
  operation?: string
  triggerMode?: boolean
}

/**
 * Hook that generates consistent block output fields using the same logic as tag-dropdown
 * Returns SchemaField[] format for use in connection-blocks component
 */
export function useBlockOutputFields({
  blockId,
  blockType,
  mergedSubBlocks,
  responseFormat,
  operation,
  triggerMode,
}: UseBlockOutputFieldsParams): SchemaField[] {
  return useMemo(() => {
    const blockConfig = getBlock(blockType)

    // Handle loop/parallel blocks without config
    if (!blockConfig && (blockType === 'loop' || blockType === 'parallel')) {
      return [
        {
          name: 'results',
          type: 'array',
          description: 'Array of results from the loop/parallel execution',
        },
      ]
    }

    if (!blockConfig) {
      return []
    }

    // Handle evaluator blocks - use metrics if available
    if (blockType === 'evaluator') {
      const metricsValue = mergedSubBlocks?.metrics?.value ?? getSubBlockValue(blockId, 'metrics')

      if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
        const validMetrics = metricsValue.filter((metric: { name?: string }) => metric?.name)
        return validMetrics.map((metric: { name: string }) => ({
          name: metric.name.toLowerCase(),
          type: 'number',
          description: `Metric: ${metric.name}`,
        }))
      }
      // Fall through to use blockConfig.outputs
    }

    // Handle variables blocks - use variable assignments if available
    if (blockType === 'variables') {
      const variablesValue =
        mergedSubBlocks?.variables?.value ?? getSubBlockValue(blockId, 'variables')

      if (variablesValue && Array.isArray(variablesValue) && variablesValue.length > 0) {
        const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
          assignment?.variableName?.trim()
        )
        return validAssignments.map((assignment: { variableName: string }) => ({
          name: assignment.variableName.trim(),
          type: 'any',
          description: `Variable: ${assignment.variableName}`,
        }))
      }
      // Fall through to empty or default
      return []
    }

    // Get base outputs using getBlockOutputs (handles triggers, starter, approval, etc.)
    let baseOutputs: Record<string, any> = {}

    if (blockConfig.category === 'triggers' || blockType === 'starter') {
      // Use getBlockOutputPaths to get dynamic outputs, then reconstruct the structure
      const outputPaths = getBlockOutputPaths(blockType, mergedSubBlocks, triggerMode)
      if (outputPaths.length > 0) {
        // Reconstruct outputs structure from paths
        // This is a simplified approach - we'll use the paths to build the structure
        baseOutputs = getBlockOutputs(blockType, mergedSubBlocks, triggerMode)
      } else if (blockType === 'starter') {
        const startWorkflowValue = mergedSubBlocks?.startWorkflow?.value
        if (startWorkflowValue === 'chat') {
          baseOutputs = {
            input: { type: 'string', description: 'User message' },
            conversationId: { type: 'string', description: 'Conversation ID' },
            files: { type: 'files', description: 'Uploaded files' },
          }
        } else {
          const inputFormatValue = mergedSubBlocks?.inputFormat?.value
          if (inputFormatValue && Array.isArray(inputFormatValue) && inputFormatValue.length > 0) {
            baseOutputs = {}
            inputFormatValue.forEach((field: { name?: string; type?: string }) => {
              if (field.name && field.name.trim() !== '') {
                baseOutputs[field.name] = {
                  type: field.type || 'string',
                  description: `Field from input format`,
                }
              }
            })
          }
        }
      } else if (blockType === TRIGGER_TYPES.GENERIC_WEBHOOK) {
        // Generic webhook returns the whole payload
        baseOutputs = {}
      } else {
        baseOutputs = {}
      }
    } else if (triggerMode && blockConfig.triggers?.enabled) {
      // Trigger mode enabled
      const dynamicOutputs = getBlockOutputPaths(blockType, mergedSubBlocks, true)
      if (dynamicOutputs.length > 0) {
        baseOutputs = getBlockOutputs(blockType, mergedSubBlocks, true)
      } else {
        baseOutputs = blockConfig.outputs || {}
      }
    } else if (blockType === 'approval') {
      // Approval block uses dynamic outputs from inputFormat
      baseOutputs = getBlockOutputs(blockType, mergedSubBlocks)
    } else {
      // For tool-based blocks, try to get tool outputs first
      const operationValue =
        operation ?? mergedSubBlocks?.operation?.value ?? getSubBlockValue(blockId, 'operation')
      const toolOutputs = operationValue ? getToolOutputs(blockConfig, operationValue) : {}

      if (Object.keys(toolOutputs).length > 0) {
        baseOutputs = toolOutputs
      } else {
        // Use getBlockOutputs which handles inputFormat merging
        baseOutputs = getBlockOutputs(blockType, mergedSubBlocks, triggerMode)
      }
    }

    // Handle responseFormat
    const responseFormatFields = responseFormat ? extractFieldsFromSchema(responseFormat) : []

    // If responseFormat exists and has fields, merge with base outputs
    if (responseFormatFields.length > 0) {
      // If base outputs is empty, use responseFormat fields directly
      if (Object.keys(baseOutputs).length === 0) {
        return responseFormatFields.map((field) => ({
          name: field.name,
          type: field.type,
          description: field.description,
          children: undefined, // ResponseFormat fields are flat
        }))
      }

      // Otherwise, merge: responseFormat takes precedence for 'data' field
      const fields: SchemaField[] = []
      const responseFormatFieldNames = new Set(responseFormatFields.map((f) => f.name))

      // Add base outputs, replacing 'data' with responseFormat fields if present
      for (const [name, output] of Object.entries(baseOutputs)) {
        if (name === 'data' && responseFormatFields.length > 0) {
          fields.push(
            createFieldFromOutput(
              name,
              output,
              responseFormatFields.map((f) => ({
                name: f.name,
                type: f.type,
                description: f.description,
              }))
            )
          )
        } else if (!responseFormatFieldNames.has(name)) {
          fields.push(createFieldFromOutput(name, output))
        }
      }

      // Add responseFormat fields that aren't in base outputs
      for (const field of responseFormatFields) {
        if (!baseOutputs[field.name]) {
          fields.push({
            name: field.name,
            type: field.type,
            description: field.description,
          })
        }
      }

      return fields
    }

    // No responseFormat, just use base outputs
    if (Object.keys(baseOutputs).length === 0) {
      return []
    }

    return Object.entries(baseOutputs).map(([name, output]) => createFieldFromOutput(name, output))
  }, [blockId, blockType, mergedSubBlocks, responseFormat, operation, triggerMode])
}
