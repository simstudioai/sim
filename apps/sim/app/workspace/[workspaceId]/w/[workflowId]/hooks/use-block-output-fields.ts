'use client'

import { useMemo } from 'react'
import {
  getEffectiveBlockOutputs,
  getEvaluatorMetricOutputs,
} from '@/lib/workflows/blocks/block-outputs'
import type { SchemaField } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/connection-blocks/components/field-item/field-item'
import { getBlock } from '@/blocks'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
const createFieldFromOutput = (name: string, output: any): SchemaField => {
  const hasExplicitType = isObject(output) && typeof output.type === 'string'
  const type = hasExplicitType ? output.type : isObject(output) ? 'object' : 'string'

  const field: SchemaField = {
    name,
    type,
    description: isObject(output) && 'description' in output ? output.description : undefined,
  }

  field.children = extractChildFields(output)

  return field
}

interface UseBlockOutputFieldsParams {
  blockId: string
  blockType: string
  mergedSubBlocks?: Record<string, any>
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
      const metricOutputs = getEvaluatorMetricOutputs(mergedSubBlocks)
      if (metricOutputs) {
        return Object.entries(metricOutputs).map(([name, output]) => ({
          name,
          type:
            output &&
            typeof output === 'object' &&
            'type' in output &&
            typeof output.type === 'string'
              ? output.type
              : 'number',
          description:
            output &&
            typeof output === 'object' &&
            'description' in output &&
            typeof output.description === 'string'
              ? output.description
              : undefined,
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

    const baseOutputs = getEffectiveBlockOutputs(blockType, mergedSubBlocks, {
      triggerMode: Boolean(triggerMode),
      preferToolOutputs: !triggerMode,
    }) as Record<string, any>
    if (Object.keys(baseOutputs).length === 0) {
      return []
    }

    return Object.entries(baseOutputs).map(([name, output]) => createFieldFromOutput(name, output))
  }, [blockId, blockType, mergedSubBlocks, triggerMode])
}
