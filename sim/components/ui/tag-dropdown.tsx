import React, { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { Variable } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('TagDropdown')

interface Field {
  name: string
  type: string
  description?: string
}

interface Metric {
  name: string
  description: string
  range: {
    min: number
    max: number
  }
}

interface TagDropdownProps {
  visible: boolean
  onSelect: (newValue: string) => void
  blockId: string
  activeSourceBlockId: string | null
  className?: string
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  style?: React.CSSProperties
}

// Add a helper function to extract fields from JSON Schema
const extractFieldsFromSchema = (responseFormat: any): Field[] => {
  if (!responseFormat) return []

  // Handle legacy format with fields array
  if (Array.isArray(responseFormat.fields)) {
    return responseFormat.fields
  }

  // Handle new JSON Schema format
  const schema = responseFormat.schema || responseFormat
  if (
    !schema ||
    typeof schema !== 'object' ||
    !('properties' in schema) ||
    typeof schema.properties !== 'object'
  ) {
    return []
  }

  return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: Array.isArray(prop) ? 'array' : prop.type || 'string',
    description: prop.description,
  }))
}

export const TagDropdown: React.FC<TagDropdownProps> = ({
  visible,
  onSelect,
  blockId,
  activeSourceBlockId,
  className,
  inputValue,
  cursorPosition,
  onClose,
  style,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Get available tags from workflow state
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get variables from variables store
  const getVariablesByWorkflowId = useVariablesStore((state) => state.getVariablesByWorkflowId)
  const loadVariables = useVariablesStore((state) => state.loadVariables)
  const variables = useVariablesStore((state) => state.variables)
  const workflowVariables = workflowId ? getVariablesByWorkflowId(workflowId) : []

  // Load variables when workflowId changes
  useEffect(() => {
    if (workflowId) {
      loadVariables(workflowId)
    }
  }, [workflowId, loadVariables])

  // Extract search term from input
  const searchTerm = useMemo(() => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const match = textBeforeCursor.match(/<([^>]*)$/)
    return match ? match[1].toLowerCase() : ''
  }, [inputValue, cursorPosition])

  // Get source block and compute tags
  const { tags, variableInfoMap = {} } = useMemo(() => {
    // Helper function to get output paths
    const getOutputPaths = (obj: any, prefix = '', isStarterBlock = false): string[] => {
      if (typeof obj !== 'object' || obj === null) {
        return prefix ? [prefix] : []
      }

      // Special handling for starter block.
      // TODO: In the future, we will support response formats and required input types. For now, we just take the input altogether.
      if (isStarterBlock && prefix === 'response') {
        return ['response.input']
      }

      if ('type' in obj && typeof obj.type === 'string') {
        return [prefix]
      }

      return Object.entries(obj).flatMap(([key, value]) => {
        const newPrefix = prefix ? `${prefix}.${key}` : key
        return getOutputPaths(value, newPrefix, isStarterBlock)
      })
    }

    // Variables as tags - format as variable.{variableName}
    const variableTags = workflowVariables.map(
      (variable: Variable) => `variable.${variable.name.replace(/\s+/g, '')}`
    )

    // Create a map of variable tags to their type information
    const variableInfoMap = workflowVariables.reduce(
      (acc, variable) => {
        const tagName = `variable.${variable.name.replace(/\s+/g, '')}`
        acc[tagName] = {
          type: variable.type,
          id: variable.id,
        }
        return acc
      },
      {} as Record<string, { type: string; id: string }>
    )

    // If we have an active source block ID from a drop, use that specific block only
    if (activeSourceBlockId) {
      const sourceBlock = blocks[activeSourceBlockId]
      if (!sourceBlock) return { tags: [...variableTags] }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // First check for evaluator metrics
      if (sourceBlock.type === 'evaluator') {
        try {
          const metricsValue = useSubBlockStore
            .getState()
            .getValue(activeSourceBlockId, 'metrics') as unknown as Metric[]
          if (Array.isArray(metricsValue)) {
            return {
              tags: [
                ...variableTags,
                ...metricsValue.map(
                  (metric) => `${normalizedBlockName}.response.${metric.name.toLowerCase()}`
                ),
              ],
            }
          }
        } catch (e) {
          logger.error('Error parsing metrics:', { e })
        }
      }

      // Then check for response format
      try {
        const responseFormatValue = useSubBlockStore
          .getState()
          .getValue(activeSourceBlockId, 'responseFormat')
        if (responseFormatValue) {
          const responseFormat =
            typeof responseFormatValue === 'string'
              ? JSON.parse(responseFormatValue)
              : responseFormatValue

          if (responseFormat) {
            const fields = extractFieldsFromSchema(responseFormat)
            if (fields.length > 0) {
              return {
                tags: [
                  ...variableTags,
                  ...fields.map((field: Field) => `${normalizedBlockName}.response.${field.name}`),
                ],
              }
            }
          }
        }
      } catch (e) {
        logger.error('Error parsing response format:', { e })
      }

      // Fall back to default outputs if no response format
      const outputPaths = getOutputPaths(sourceBlock.outputs, '', sourceBlock.type === 'starter')
      return {
        tags: [...variableTags, ...outputPaths.map((path) => `${normalizedBlockName}.${path}`)],
      }
    }

    // Otherwise, show tags from all incoming connections
    const sourceEdges = edges.filter((edge) => edge.target === blockId)
    const sourceTags = sourceEdges.flatMap((edge) => {
      const sourceBlock = blocks[edge.source]
      if (!sourceBlock) return []

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Check for response format first
      try {
        const responseFormatValue = useSubBlockStore
          .getState()
          .getValue(edge.source, 'responseFormat')
        if (responseFormatValue) {
          const responseFormat =
            typeof responseFormatValue === 'string'
              ? JSON.parse(responseFormatValue)
              : responseFormatValue

          if (responseFormat) {
            const fields = extractFieldsFromSchema(responseFormat)
            if (fields.length > 0) {
              return fields.map((field: Field) => `${normalizedBlockName}.response.${field.name}`)
            }
          }
        }
      } catch (e) {
        logger.error('Error parsing response format:', { e })
      }

      if (sourceBlock.type === 'evaluator') {
        try {
          const metricsValue = useSubBlockStore
            .getState()
            .getValue(edge.source, 'metrics') as unknown as Metric[]
          if (Array.isArray(metricsValue)) {
            return metricsValue.map(
              (metric) => `${normalizedBlockName}.response.${metric.name.toLowerCase()}`
            )
          }
        } catch (e) {
          logger.error('Error parsing metrics:', { e })
          return []
        }
      }

      // Fall back to default outputs if no response format
      const outputPaths = getOutputPaths(sourceBlock.outputs, '', sourceBlock.type === 'starter')
      return outputPaths.map((path) => `${normalizedBlockName}.${path}`)
    })

    return { tags: [...variableTags, ...sourceTags], variableInfoMap }
  }, [blocks, edges, blockId, activeSourceBlockId, workflowVariables])

  // Filter tags based on search term
  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchTerm])

  // Handle tag selection
  const handleTagSelect = (tag: string) => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const textAfterCursor = inputValue.slice(cursorPosition)

    // Find the position of the last '<' before cursor
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    if (lastOpenBracket === -1) return

    // Process the tag if it's a variable tag
    let processedTag = tag
    if (tag.startsWith('variable.')) {
      // Get the variable name from the tag (after 'variable.')
      const variableName = tag.substring('variable.'.length)

      // Find the variable in the store by name
      const variableObj = Object.values(variables).find(
        (v) => v.name.replace(/\s+/g, '') === variableName
      )

      // Use the tag as is if variable not found
      if (variableObj) {
        processedTag = tag
      }
    }

    const newValue =
      textBeforeCursor.slice(0, lastOpenBracket) + '<' + processedTag + '>' + textAfterCursor

    onSelect(newValue)
    onClose?.()
  }

  // Add and remove keyboard event listener
  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        if (!filteredTags.length) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev < filteredTags.length - 1 ? prev + 1 : prev))
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
            break
          case 'Enter':
            e.preventDefault()
            e.stopPropagation()
            handleTagSelect(filteredTags[selectedIndex])
            break
          case 'Escape':
            e.preventDefault()
            e.stopPropagation()
            onClose?.()
            break
        }
      }

      window.addEventListener('keydown', handleKeyboardEvent, true)
      return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
    }
  }, [visible, selectedIndex, filteredTags])

  // Don't render if not visible or no tags
  if (!visible || tags.length === 0 || filteredTags.length === 0) return null

  return (
    <div
      className={cn(
        'absolute z-[9999] w-full mt-1 overflow-hidden bg-popover rounded-md border shadow-md',
        className
      )}
      style={style}
    >
      <div className="py-1">
        {filteredTags.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matching tags found</div>
        ) : (
          filteredTags.map((tag: string, index: number) => {
            const isVariable = tag.startsWith('variable.')
            const variableInfo = isVariable ? variableInfoMap?.[tag] : null

            return (
              <button
                key={tag}
                className={cn(
                  'w-full px-3 py-1.5 text-sm text-left flex items-center',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                  index === selectedIndex && 'bg-accent text-accent-foreground',
                  isVariable && 'font-medium'
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault() // Prevent input blur
                  handleTagSelect(tag)
                }}
              >
                {isVariable && (
                  <span className="mr-2 inline-block w-2 h-2 rounded-full bg-blue-500" />
                )}
                <span className="flex-1">{tag}</span>
                {isVariable && variableInfo && (
                  <span className="ml-2 text-xs text-muted-foreground">{variableInfo.type}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// Helper function to check for '<' trigger
export const checkTagTrigger = (text: string, cursorPosition: number): { show: boolean } => {
  if (cursorPosition >= 1) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    const lastCloseBracket = textBeforeCursor.lastIndexOf('>')

    // Show if we have an unclosed '<' that's not part of a completed tag
    if (lastOpenBracket !== -1 && (lastCloseBracket === -1 || lastCloseBracket < lastOpenBracket)) {
      return { show: true }
    }
  }
  return { show: false }
}
