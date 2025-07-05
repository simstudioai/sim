import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { Serializer } from '@/serializer'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('TagDropdown')

// Type definitions for component data structures
interface BlockTagGroup {
  blockName: string
  blockId: string
  blockType: string
  tags: string[]
  distance: number
}

interface Field {
  name: string
  type: string
  description?: string
}

// Helper function to extract fields from JSON Schema
export function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  // Handle legacy format with fields array
  if (Array.isArray(schema.fields)) {
    return schema.fields
  }

  // Handle new JSON Schema format
  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => {
    // Handle array format like ['string', 'array']
    if (Array.isArray(prop)) {
      return {
        name,
        type: prop.includes('array') ? 'array' : prop[0] || 'string',
        description: undefined,
      }
    }

    // Handle object format like { type: 'string', description: '...' }
    return {
      name,
      type: prop.type || 'string',
      description: prop.description,
    }
  })
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

// Check if tag trigger '<' should show dropdown
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

// Generate output paths from block configuration outputs
const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
  const paths: string[] = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      // Simple type like 'string', 'number', 'json', 'any'
      paths.push(currentPath)
    } else if (typeof value === 'object' && value !== null) {
      // Nested object - recurse
      const subPaths = generateOutputPaths(value, currentPath)
      paths.push(...subPaths)
    } else {
      // Fallback - add the path
      paths.push(currentPath)
    }
  }

  return paths
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
  // Component state
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Store hooks for workflow data
  const blocks = useWorkflowStore((state) => state.blocks)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)
  const edges = useWorkflowStore((state) => state.edges)
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Store hooks for variables
  const getVariablesByWorkflowId = useVariablesStore((state) => state.getVariablesByWorkflowId)
  const loadVariables = useVariablesStore((state) => state.loadVariables)
  const variables = useVariablesStore((state) => state.variables)
  const workflowVariables = workflowId ? getVariablesByWorkflowId(workflowId) : []

  // Load variables when workflow changes
  useEffect(() => {
    if (workflowId) {
      loadVariables(workflowId)
    }
  }, [workflowId, loadVariables])

  // Extract current search term from input
  const searchTerm = useMemo(() => {
    const textBeforeCursor = inputValue.slice(0, cursorPosition)
    const match = textBeforeCursor.match(/<([^>]*)$/)
    return match ? match[1].toLowerCase() : ''
  }, [inputValue, cursorPosition])

  // Generate all available tags using BlockPathCalculator and clean block outputs
  const {
    tags,
    variableInfoMap = {},
    blockTagGroups = [],
  } = useMemo(() => {
    // Handle active source block (drag & drop from specific block)
    if (activeSourceBlockId) {
      const sourceBlock = blocks[activeSourceBlockId]
      if (!sourceBlock) {
        return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
      }

      const blockConfig = getBlock(sourceBlock.type)
      if (!blockConfig) {
        return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
      }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Handle blocks with no outputs (like starter) - show as just <blockname>
      let blockTags: string[]
      if (Object.keys(blockConfig.outputs).length === 0) {
        blockTags = [normalizedBlockName]
      } else {
        const outputPaths = generateOutputPaths(blockConfig.outputs)
        blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
      }

      const blockTagGroups: BlockTagGroup[] = [
        {
          blockName,
          blockId: activeSourceBlockId,
          blockType: sourceBlock.type,
          tags: blockTags,
          distance: 0,
        },
      ]

      return {
        tags: blockTags,
        variableInfoMap: {},
        blockTagGroups,
      }
    }

    // Check for invalid blocks before serialization to prevent race conditions
    const hasInvalidBlocks = Object.values(blocks).some((block) => !block || !block.type)
    if (hasInvalidBlocks) {
      return {
        tags: [],
        variableInfoMap: {},
        blockTagGroups: [],
      }
    }

    // Create serialized workflow for BlockPathCalculator
    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(blocks, edges, loops, parallels)

    // Find accessible blocks using BlockPathCalculator
    const accessibleBlockIds = BlockPathCalculator.findAllPathNodes(
      serializedWorkflow.connections,
      blockId
    )

    // Always include starter block
    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
    if (starterBlock && !accessibleBlockIds.includes(starterBlock.id)) {
      accessibleBlockIds.push(starterBlock.id)
    }

    // Calculate distances from starter block for ordering
    const blockDistances: Record<string, number> = {}
    if (starterBlock) {
      const adjList: Record<string, string[]> = {}
      for (const edge of edges) {
        if (!adjList[edge.source]) adjList[edge.source] = []
        adjList[edge.source].push(edge.target)
      }

      const visited = new Set<string>()
      const queue: [string, number][] = [[starterBlock.id, 0]]

      while (queue.length > 0) {
        const [currentNodeId, distance] = queue.shift()!
        if (visited.has(currentNodeId)) continue
        visited.add(currentNodeId)
        blockDistances[currentNodeId] = distance

        const outgoingNodeIds = adjList[currentNodeId] || []
        for (const targetId of outgoingNodeIds) {
          queue.push([targetId, distance + 1])
        }
      }
    }

    // Create variable tags
    const variableTags = workflowVariables.map(
      (variable: Variable) => `variable.${variable.name.replace(/\s+/g, '')}`
    )

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

    // Generate loop tags if current block is in a loop
    const loopTags: string[] = []
    const containingLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(blockId))
    if (containingLoop) {
      const [_loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'
      loopTags.push('loop.index')
      if (loopType === 'forEach') {
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

    // Generate parallel tags if current block is in parallel
    const parallelTags: string[] = []
    const containingParallel = Object.entries(parallels || {}).find(([_, parallel]) =>
      parallel.nodes.includes(blockId)
    )
    if (containingParallel) {
      parallelTags.push('parallel.index')
      parallelTags.push('parallel.currentItem')
      parallelTags.push('parallel.items')
    }

    // Create block tag groups from accessible blocks
    const blockTagGroups: BlockTagGroup[] = []
    const allBlockTags: string[] = []

    for (const accessibleBlockId of accessibleBlockIds) {
      const accessibleBlock = blocks[accessibleBlockId]
      if (!accessibleBlock) continue

      const blockConfig = getBlock(accessibleBlock.type)
      if (!blockConfig) continue

      const blockName = accessibleBlock.name || accessibleBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Handle blocks with no outputs (like starter) - show as just <blockname>
      let blockTags: string[]
      if (Object.keys(blockConfig.outputs).length === 0) {
        blockTags = [normalizedBlockName]
      } else {
        const outputPaths = generateOutputPaths(blockConfig.outputs)
        blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
      }

      blockTagGroups.push({
        blockName,
        blockId: accessibleBlockId,
        blockType: accessibleBlock.type,
        tags: blockTags,
        distance: blockDistances[accessibleBlockId] || 0,
      })

      allBlockTags.push(...blockTags)
    }

    // Sort block groups by distance (closest first)
    blockTagGroups.sort((a, b) => a.distance - b.distance)

    return {
      tags: [...variableTags, ...loopTags, ...parallelTags, ...allBlockTags],
      variableInfoMap,
      blockTagGroups,
    }
  }, [blocks, edges, loops, parallels, blockId, activeSourceBlockId, workflowVariables])

  // Filter tags based on search term
  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  // Group filtered tags by category
  const { variableTags, loopTags, parallelTags, filteredBlockTagGroups } = useMemo(() => {
    const varTags: string[] = []
    const loopTags: string[] = []
    const parTags: string[] = []

    filteredTags.forEach((tag) => {
      if (tag.startsWith('variable.')) {
        varTags.push(tag)
      } else if (tag.startsWith('loop.')) {
        loopTags.push(tag)
      } else if (tag.startsWith('parallel.')) {
        parTags.push(tag)
      }
    })

    // Filter block tag groups based on search term
    const filteredBlockTagGroups = blockTagGroups
      .map((group) => ({
        ...group,
        tags: group.tags.filter((tag) => !searchTerm || tag.toLowerCase().includes(searchTerm)),
      }))
      .filter((group) => group.tags.length > 0)

    return {
      variableTags: varTags,
      loopTags: loopTags,
      parallelTags: parTags,
      filteredBlockTagGroups,
    }
  }, [filteredTags, blockTagGroups, searchTerm])

  // Create ordered tags for keyboard navigation
  const orderedTags = useMemo(() => {
    const allBlockTags = filteredBlockTagGroups.flatMap((group) => group.tags)
    return [...variableTags, ...loopTags, ...parallelTags, ...allBlockTags]
  }, [variableTags, loopTags, parallelTags, filteredBlockTagGroups])

  // Create efficient tag index lookup map
  const tagIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    orderedTags.forEach((tag, index) => {
      map.set(tag, index)
    })
    return map
  }, [orderedTags])

  // Handle tag selection and text replacement
  const handleTagSelect = useCallback(
    (tag: string) => {
      const textBeforeCursor = inputValue.slice(0, cursorPosition)
      const textAfterCursor = inputValue.slice(cursorPosition)

      // Find the position of the last '<' before cursor
      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
      if (lastOpenBracket === -1) return

      // Process variable tags to maintain compatibility
      let processedTag = tag
      if (tag.startsWith('variable.')) {
        const variableName = tag.substring('variable.'.length)
        const variableObj = Object.values(variables).find(
          (v) => v.name.replace(/\s+/g, '') === variableName
        )

        if (variableObj) {
          processedTag = tag
        }
      }

      // Handle existing closing bracket
      const nextCloseBracket = textAfterCursor.indexOf('>')
      let remainingTextAfterCursor = textAfterCursor

      if (nextCloseBracket !== -1) {
        const textBetween = textAfterCursor.slice(0, nextCloseBracket)
        // If text between cursor and '>' contains only tag-like characters, skip it
        if (/^[a-zA-Z0-9._]*$/.test(textBetween)) {
          remainingTextAfterCursor = textAfterCursor.slice(nextCloseBracket + 1)
        }
      }

      const newValue = `${textBeforeCursor.slice(0, lastOpenBracket)}<${processedTag}>${remainingTextAfterCursor}`

      onSelect(newValue)
      onClose?.()
    },
    [inputValue, cursorPosition, variables, onSelect, onClose]
  )

  // Reset selection when search results change
  useEffect(() => setSelectedIndex(0), [searchTerm])

  // Keep selection within bounds when tags change
  useEffect(() => {
    if (selectedIndex >= orderedTags.length) {
      setSelectedIndex(Math.max(0, orderedTags.length - 1))
    }
  }, [orderedTags.length, selectedIndex])

  // Handle keyboard navigation
  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        if (!orderedTags.length) return

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => Math.min(prev + 1, orderedTags.length - 1))
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            setSelectedIndex((prev) => Math.max(prev - 1, 0))
            break
          case 'Enter':
            e.preventDefault()
            e.stopPropagation()
            if (selectedIndex >= 0 && selectedIndex < orderedTags.length) {
              handleTagSelect(orderedTags[selectedIndex])
            }
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
  }, [visible, selectedIndex, orderedTags, handleTagSelect, onClose])

  // Early return if dropdown should not be visible
  if (!visible || tags.length === 0 || orderedTags.length === 0) return null

  return (
    <div
      className={cn(
        'absolute z-[9999] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md',
        className
      )}
      style={style}
    >
      <div className='py-1'>
        {orderedTags.length === 0 ? (
          <div className='px-3 py-2 text-muted-foreground text-sm'>No matching tags found</div>
        ) : (
          <>
            {/* Variables section */}
            {variableTags.length > 0 && (
              <>
                <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                  Variables
                </div>
                <div className='-mx-1 -px-1'>
                  {variableTags.map((tag: string) => {
                    const variableInfo = variableInfoMap?.[tag] || null
                    const tagIndex = tagIndexMap.get(tag) ?? -1

                    return (
                      <button
                        key={tag}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex &&
                            tagIndex >= 0 &&
                            'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex >= 0 ? tagIndex : 0)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className='flex h-5 w-5 items-center justify-center rounded'
                          style={{ backgroundColor: '#2F8BFF' }}
                        >
                          <span className='h-3 w-3 font-bold text-white text-xs'>V</span>
                        </div>
                        <span className='flex-1 truncate'>
                          {tag.startsWith('variable.') ? tag.substring('variable.'.length) : tag}
                        </span>
                        {variableInfo && (
                          <span className='ml-auto text-muted-foreground text-xs'>
                            {variableInfo.type}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* Loop section */}
            {loopTags.length > 0 && (
              <>
                {variableTags.length > 0 && <div className='my-0' />}
                <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                  Loop
                </div>
                <div className='-mx-1 -px-1'>
                  {loopTags.map((tag: string) => {
                    const tagIndex = tagIndexMap.get(tag) ?? -1
                    const loopProperty = tag.split('.')[1]

                    // Choose appropriate icon and description based on loop property
                    let tagIcon = 'L'
                    let tagDescription = ''
                    const bgColor = '#8857E6'

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
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex &&
                            tagIndex >= 0 &&
                            'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex >= 0 ? tagIndex : 0)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className='flex h-5 w-5 items-center justify-center rounded'
                          style={{ backgroundColor: bgColor }}
                        >
                          <span className='h-3 w-3 font-bold text-white text-xs'>{tagIcon}</span>
                        </div>
                        <span className='flex-1 truncate'>{tag}</span>
                        <span className='ml-auto text-muted-foreground text-xs'>
                          {tagDescription}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* Parallel section */}
            {parallelTags.length > 0 && (
              <>
                {loopTags.length > 0 && <div className='my-0' />}
                <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                  Parallel
                </div>
                <div className='-mx-1 -px-1'>
                  {parallelTags.map((tag: string) => {
                    const tagIndex = tagIndexMap.get(tag) ?? -1
                    const parallelProperty = tag.split('.')[1]

                    // Choose appropriate icon and description based on parallel property
                    let tagIcon = 'P'
                    let tagDescription = ''
                    const bgColor = '#FF5757'

                    if (parallelProperty === 'currentItem') {
                      tagIcon = 'i'
                      tagDescription = 'Current item'
                    } else if (parallelProperty === 'items') {
                      tagIcon = 'I'
                      tagDescription = 'All items'
                    } else if (parallelProperty === 'index') {
                      tagIcon = '#'
                      tagDescription = 'Index'
                    }

                    return (
                      <button
                        key={tag}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                          'hover:bg-accent hover:text-accent-foreground',
                          'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                          tagIndex === selectedIndex &&
                            tagIndex >= 0 &&
                            'bg-accent text-accent-foreground'
                        )}
                        onMouseEnter={() => setSelectedIndex(tagIndex >= 0 ? tagIndex : 0)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                      >
                        <div
                          className='flex h-5 w-5 items-center justify-center rounded'
                          style={{ backgroundColor: bgColor }}
                        >
                          <span className='h-3 w-3 font-bold text-white text-xs'>{tagIcon}</span>
                        </div>
                        <span className='flex-1 truncate'>{tag}</span>
                        <span className='ml-auto text-muted-foreground text-xs'>
                          {tagDescription}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* Block sections */}
            {filteredBlockTagGroups.length > 0 && (
              <>
                {(variableTags.length > 0 || loopTags.length > 0 || parallelTags.length > 0) && (
                  <div className='my-0' />
                )}
                {filteredBlockTagGroups.map((group) => {
                  // Get block color from configuration
                  const blockConfig = getBlock(group.blockType)
                  const blockColor = blockConfig?.bgColor || '#2F55FF'

                  return (
                    <div key={group.blockId}>
                      <div className='border-t px-2 pt-1.5 pb-0.5 font-medium text-muted-foreground text-xs first:border-t-0'>
                        {group.blockName}
                      </div>
                      <div>
                        {group.tags.map((tag: string) => {
                          const tagIndex = tagIndexMap.get(tag) ?? -1
                          // Extract path after block name (e.g., "field" from "blockname.field")
                          // For root reference blocks, show the block name instead of empty path
                          const tagParts = tag.split('.')
                          const path = tagParts.slice(1).join('.')
                          const displayText = path || group.blockName

                          return (
                            <button
                              key={tag}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                'hover:bg-accent hover:text-accent-foreground',
                                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                                tagIndex === selectedIndex &&
                                  tagIndex >= 0 &&
                                  'bg-accent text-accent-foreground'
                              )}
                              onMouseEnter={() => setSelectedIndex(tagIndex >= 0 ? tagIndex : 0)}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleTagSelect(tag)
                              }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleTagSelect(tag)
                              }}
                            >
                              <div
                                className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
                                style={{ backgroundColor: blockColor }}
                              >
                                <span className='h-3 w-3 font-bold text-white text-xs'>
                                  {group.blockName.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <span className='max-w-[calc(100%-32px)] truncate'>
                                {displayText}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
