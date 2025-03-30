import React, { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { Variable } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ConnectedBlock, useBlockConnections } from '@/app/w/[id]/hooks/use-block-connections'
import { getBlock } from '@/blocks'

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
  const loops = useWorkflowStore((state) => state.loops)

  // Get variables from variables store
  const getVariablesByWorkflowId = useVariablesStore((state) => state.getVariablesByWorkflowId)
  const loadVariables = useVariablesStore((state) => state.loadVariables)
  const variables = useVariablesStore((state) => state.variables)
  const workflowVariables = workflowId ? getVariablesByWorkflowId(workflowId) : []

  // Get all connected blocks using useBlockConnections
  const { incomingConnections } = useBlockConnections(blockId)

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

      // Special handling for starter block with input format
      if (isStarterBlock && prefix === 'response') {
        try {
          // Check if there's an input format defined
          const inputFormatValue = useSubBlockStore
            .getState()
            .getValue(activeSourceBlockId || blockId, 'inputFormat')
          if (inputFormatValue && Array.isArray(inputFormatValue) && inputFormatValue.length > 0) {
            // Check if any fields have been configured with names
            const hasConfiguredFields = inputFormatValue.some(
              (field: any) => field.name && field.name.trim() !== ''
            )

            // If no fields have been configured, return the default input path
            if (!hasConfiguredFields) {
              return ['response.input']
            }

            // Return fields from input format
            return inputFormatValue.map((field: any) => `response.input.${field.name}`)
          }
        } catch (e) {
          logger.error('Error parsing input format:', { e })
        }

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

    // Loop tags - Add if this block is in a loop
    const loopTags: string[] = []

    // Check if the current block is part of a loop
    const containingLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(blockId))

    if (containingLoop) {
      const [loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'

      // Add loop.index for all loop types
      loopTags.push('loop.index')

      // Add forEach specific properties
      if (loopType === 'forEach') {
        // Add loop.currentItem and loop.items
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

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

    // Use all incoming connections instead of just direct edges
    const sourceTags = incomingConnections.flatMap((connection: ConnectedBlock) => {
      const blockName = connection.name || connection.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Extract fields from response format
      if (connection.responseFormat) {
        const fields = extractFieldsFromSchema(connection.responseFormat)
        if (fields.length > 0) {
          return fields.map((field: Field) => `${normalizedBlockName}.response.${field.name}`)
        }
      }

      // For evaluator blocks, use metrics
      if (connection.type === 'evaluator') {
        try {
          const metricsValue = useSubBlockStore
            .getState()
            .getValue(connection.id, 'metrics') as unknown as Metric[]
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
      const sourceBlock = blocks[connection.id]
      if (!sourceBlock) return []

      const outputPaths = getOutputPaths(sourceBlock.outputs, '', sourceBlock.type === 'starter')
      return outputPaths.map((path) => `${normalizedBlockName}.${path}`)
    })

    return { tags: [...variableTags, ...loopTags, ...sourceTags], variableInfoMap }
  }, [blocks, incomingConnections, blockId, activeSourceBlockId, workflowVariables, loops])

  // Filter tags based on search term
  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  // Group tags into variables, loops, and blocks
  const { variableTags, loopTags, blockTags } = useMemo(() => {
    const varTags: string[] = []
    const loopTags: string[] = []
    const blkTags: string[] = []

    filteredTags.forEach((tag) => {
      if (tag.startsWith('variable.')) {
        varTags.push(tag)
      } else if (tag.startsWith('loop.')) {
        loopTags.push(tag)
      } else {
        blkTags.push(tag)
      }
    })

    return { variableTags: varTags, loopTags: loopTags, blockTags: blkTags }
  }, [filteredTags])

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

      // We still use the full tag format internally to maintain compatibility
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
          <>
            {variableTags.length > 0 && (
              <>
                <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                  Variables
                </div>
                <div className="-mx-1 -px-1">
                  {variableTags.map((tag: string, index: number) => {
                    const variableInfo = variableInfoMap?.[tag] || null
                    const tagIndex = filteredTags.indexOf(tag)

                    return (
                      <button
                        key={tag}
                        className={cn(
                          'w-full px-3 py-1.5 text-sm text-left flex items-center gap-2',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex && 'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault() // Prevent input blur
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className="flex items-center justify-center w-5 h-5 rounded"
                          style={{ backgroundColor: '#2F8BFF' }}
                        >
                          <span className="w-3 h-3 text-white font-bold text-xs">V</span>
                        </div>
                        <span className="flex-1 truncate">
                          {tag.startsWith('variable.') ? tag.substring('variable.'.length) : tag}
                        </span>
                        {variableInfo && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {variableInfo.type}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {loopTags.length > 0 && (
              <>
                {variableTags.length > 0 && <div className="my-0" />}
                <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                  Loop
                </div>
                <div className="-mx-1 -px-1">
                  {loopTags.map((tag: string, index: number) => {
                    const tagIndex = filteredTags.indexOf(tag)
                    const loopProperty = tag.split('.')[1]

                    // Choose appropriate icon/label based on type
                    let tagIcon = 'L'
                    let tagDescription = ''
                    let bgColor = '#8857E6' // Purple for loop variables

                    if (loopProperty === 'currentItem') {
                      tagIcon = 'i'
                      tagDescription = 'Current item'
                    } else if (loopProperty === 'items') {
                      tagIcon = 'I'
                      tagDescription = 'All items'
                    } else if (loopProperty === 'index') {
                      tagIcon = '#'
                      tagDescription = 'Index'
                    }

                    return (
                      <button
                        key={tag}
                        className={cn(
                          'w-full px-3 py-1.5 text-sm text-left flex items-center gap-2',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex && 'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault() // Prevent input blur
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className="flex items-center justify-center w-5 h-5 rounded"
                          style={{ backgroundColor: bgColor }}
                        >
                          <span className="w-3 h-3 text-white font-bold text-xs">{tagIcon}</span>
                        </div>
                        <span className="flex-1 truncate">{tag}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {tagDescription}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {blockTags.length > 0 && (
              <>
                {(variableTags.length > 0 || loopTags.length > 0) && <div className="my-0" />}
                <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                  Blocks
                </div>
                <div className="-mx-1 -px-1">
                  {blockTags.map((tag: string, index: number) => {
                    const tagIndex = filteredTags.indexOf(tag)

                    // Get block name from tag (first part before the dot)
                    const blockName = tag.split('.')[0]

                    // Get block type from blocks
                    const blockType = Object.values(blocks).find(
                      (block) =>
                        (block.name || block.type).replace(/\s+/g, '').toLowerCase() === blockName
                    )?.type

                    // Get block color from block config
                    const blockConfig = blockType ? getBlock(blockType) : null
                    const blockColor = blockConfig?.bgColor || '#2F55FF' // Default to blue if not found

                    return (
                      <button
                        key={tag}
                        className={cn(
                          'w-full px-3 py-1.5 text-sm text-left flex items-center gap-2',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex && 'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault() // Prevent input blur
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className="flex items-center justify-center w-5 h-5 rounded"
                          style={{ backgroundColor: blockColor }}
                        >
                          <span className="w-3 h-3 text-white font-bold text-xs">
                            {blockName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="flex-1 truncate">{tag}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </>
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
