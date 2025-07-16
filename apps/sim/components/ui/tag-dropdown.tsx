import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { Serializer } from '@/serializer'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface BlockTagGroup {
  blockName: string
  blockId: string
  blockType: string
  tags: string[]
  distance: number
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

      // Handle special blocks that aren't in the registry (loop and parallel)
      if (!blockConfig) {
        if (sourceBlock.type === 'loop' || sourceBlock.type === 'parallel') {
          // Create a mock config with results output for loop/parallel blocks
          const mockConfig = {
            outputs: {
              results: 'array', // These blocks have a results array output
            },
          }
          const blockName = sourceBlock.name || sourceBlock.type
          const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

          // Generate output paths for the mock config
          const outputPaths = generateOutputPaths(mockConfig.outputs)
          const blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)

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
        return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
      }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Check for custom response format first
      const responseFormatValue = useSubBlockStore
        .getState()
        .getValue(activeSourceBlockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, activeSourceBlockId)

      let blockTags: string[]

      if (responseFormat) {
        // Use custom schema properties if response format is specified
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          // Fallback to default if schema extraction failed
          const outputPaths = generateOutputPaths(blockConfig.outputs)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (Object.keys(blockConfig.outputs).length === 0) {
        // Handle blocks with no outputs (like starter) - show as just <blockname>
        blockTags = [normalizedBlockName]
      } else {
        // Use default block outputs
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

    // Create variable tags - filter out variables with empty names
    const validVariables = workflowVariables.filter(
      (variable: Variable) => variable.name.trim() !== ''
    )

    const variableTags = validVariables.map(
      (variable: Variable) => `variable.${variable.name.replace(/\s+/g, '')}`
    )

    const variableInfoMap = validVariables.reduce(
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

    // Generate loop contextual block group if current block is in a loop
    let loopBlockGroup: BlockTagGroup | null = null
    const containingLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(blockId))
    let containingLoopBlockId: string | null = null
    if (containingLoop) {
      const [loopId, loop] = containingLoop
      containingLoopBlockId = loopId
      const loopType = loop.loopType || 'for'
      const contextualTags: string[] = ['index']
      if (loopType === 'forEach') {
        contextualTags.push('currentItem')
        contextualTags.push('items')
      }

      // Add the containing loop block's results to the contextual tags
      const containingLoopBlock = blocks[loopId]
      if (containingLoopBlock) {
        const loopBlockName = containingLoopBlock.name || containingLoopBlock.type
        const normalizedLoopBlockName = loopBlockName.replace(/\s+/g, '').toLowerCase()
        contextualTags.push(`${normalizedLoopBlockName}.results`)

        // Create a block group for the loop contextual tags
        loopBlockGroup = {
          blockName: loopBlockName,
          blockId: loopId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0, // Contextual tags have highest priority
        }
      }
    }

    // Generate parallel contextual block group if current block is in parallel
    let parallelBlockGroup: BlockTagGroup | null = null
    const containingParallel = Object.entries(parallels || {}).find(([_, parallel]) =>
      parallel.nodes.includes(blockId)
    )
    let containingParallelBlockId: string | null = null
    if (containingParallel) {
      const [parallelId] = containingParallel
      containingParallelBlockId = parallelId
      const contextualTags: string[] = ['index', 'currentItem', 'items']

      // Add the containing parallel block's results to the contextual tags
      const containingParallelBlock = blocks[parallelId]
      if (containingParallelBlock) {
        const parallelBlockName = containingParallelBlock.name || containingParallelBlock.type
        const normalizedParallelBlockName = parallelBlockName.replace(/\s+/g, '').toLowerCase()
        contextualTags.push(`${normalizedParallelBlockName}.results`)

        // Create a block group for the parallel contextual tags
        parallelBlockGroup = {
          blockName: parallelBlockName,
          blockId: parallelId,
          blockType: 'parallel',
          tags: contextualTags,
          distance: 0, // Contextual tags have highest priority
        }
      }
    }

    // Create block tag groups from accessible blocks
    const blockTagGroups: BlockTagGroup[] = []
    const allBlockTags: string[] = []

    for (const accessibleBlockId of accessibleBlockIds) {
      const accessibleBlock = blocks[accessibleBlockId]
      if (!accessibleBlock) continue

      const blockConfig = getBlock(accessibleBlock.type)

      // Handle special blocks that aren't in the registry (loop and parallel)
      if (!blockConfig) {
        // For loop and parallel blocks, create a mock config with results output
        if (accessibleBlock.type === 'loop' || accessibleBlock.type === 'parallel') {
          // Skip this block if it's the containing loop/parallel block - we'll handle it with contextual tags
          if (
            accessibleBlockId === containingLoopBlockId ||
            accessibleBlockId === containingParallelBlockId
          ) {
            continue
          }

          const mockConfig = {
            outputs: {
              results: 'array', // These blocks have a results array output
            },
          }
          const blockName = accessibleBlock.name || accessibleBlock.type
          const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

          // Generate output paths for the mock config
          const outputPaths = generateOutputPaths(mockConfig.outputs)
          const blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)

          blockTagGroups.push({
            blockName,
            blockId: accessibleBlockId,
            blockType: accessibleBlock.type,
            tags: blockTags,
            distance: blockDistances[accessibleBlockId] || 0,
          })

          allBlockTags.push(...blockTags)
        }
        continue
      }

      const blockName = accessibleBlock.name || accessibleBlock.type
      const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase()

      // Check for custom response format first
      const responseFormatValue = useSubBlockStore
        .getState()
        .getValue(accessibleBlockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, accessibleBlockId)

      let blockTags: string[]

      if (responseFormat) {
        // Use custom schema properties if response format is specified
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          // Fallback to default if schema extraction failed
          const outputPaths = generateOutputPaths(blockConfig.outputs)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (Object.keys(blockConfig.outputs).length === 0) {
        // Handle blocks with no outputs (like starter) - show as just <blockname>
        blockTags = [normalizedBlockName]
      } else {
        // Use default block outputs
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

    // Add contextual block groups at the beginning (they have highest priority)
    const finalBlockTagGroups: BlockTagGroup[] = []
    if (loopBlockGroup) {
      finalBlockTagGroups.push(loopBlockGroup)
    }
    if (parallelBlockGroup) {
      finalBlockTagGroups.push(parallelBlockGroup)
    }

    // Sort regular block groups by distance (closest first) and add them
    blockTagGroups.sort((a, b) => a.distance - b.distance)
    finalBlockTagGroups.push(...blockTagGroups)

    // Collect all tags for the main tags array
    const contextualTags: string[] = []
    if (loopBlockGroup) {
      contextualTags.push(...loopBlockGroup.tags)
    }
    if (parallelBlockGroup) {
      contextualTags.push(...parallelBlockGroup.tags)
    }

    return {
      tags: [...variableTags, ...contextualTags, ...allBlockTags],
      variableInfoMap,
      blockTagGroups: finalBlockTagGroups,
    }
  }, [blocks, edges, loops, parallels, blockId, activeSourceBlockId, workflowVariables])

  // Filter tags based on search term
  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  // Group filtered tags by category
  const { variableTags, filteredBlockTagGroups } = useMemo(() => {
    const varTags: string[] = []

    filteredTags.forEach((tag) => {
      if (tag.startsWith('variable.')) {
        varTags.push(tag)
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
      filteredBlockTagGroups,
    }
  }, [filteredTags, blockTagGroups, searchTerm])

  // Create ordered tags for keyboard navigation
  const orderedTags = useMemo(() => {
    const allBlockTags = filteredBlockTagGroups.flatMap((group) => group.tags)
    return [...variableTags, ...allBlockTags]
  }, [variableTags, filteredBlockTagGroups])

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
    (tag: string, blockGroup?: BlockTagGroup) => {
      const textBeforeCursor = inputValue.slice(0, cursorPosition)
      const textAfterCursor = inputValue.slice(cursorPosition)

      // Find the position of the last '<' before cursor
      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
      if (lastOpenBracket === -1) return

      // Process different types of tags
      let processedTag = tag

      // Handle variable tags
      if (tag.startsWith('variable.')) {
        const variableName = tag.substring('variable.'.length)
        const variableObj = Object.values(variables).find(
          (v) => v.name.replace(/\s+/g, '') === variableName
        )

        if (variableObj) {
          processedTag = tag
        }
      }
      // Handle contextual loop/parallel tags
      else if (
        blockGroup &&
        (blockGroup.blockType === 'loop' || blockGroup.blockType === 'parallel')
      ) {
        // Check if this is a contextual tag (without dots) that needs a prefix
        if (!tag.includes('.') && ['index', 'currentItem', 'items'].includes(tag)) {
          processedTag = `${blockGroup.blockType}.${tag}`
        } else {
          // It's already a properly formatted tag (like blockname.results)
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
              const selectedTag = orderedTags[selectedIndex]
              // Find which block group this tag belongs to
              const belongsToGroup = filteredBlockTagGroups.find((group) =>
                group.tags.includes(selectedTag)
              )
              handleTagSelect(selectedTag, belongsToGroup)
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
  }, [visible, selectedIndex, orderedTags, filteredBlockTagGroups, handleTagSelect, onClose])

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

            {/* Block sections */}
            {filteredBlockTagGroups.length > 0 && (
              <>
                {variableTags.length > 0 && <div className='my-0' />}
                {filteredBlockTagGroups.map((group) => {
                  // Get block color from configuration
                  const blockConfig = getBlock(group.blockType)
                  let blockColor = blockConfig?.bgColor || '#2F55FF'

                  // Handle special colors for loop and parallel blocks
                  if (group.blockType === 'loop') {
                    blockColor = '#8857E6' // Purple color for loop blocks
                  } else if (group.blockType === 'parallel') {
                    blockColor = '#FF5757' // Red color for parallel blocks
                  }

                  return (
                    <div key={group.blockId}>
                      <div className='border-t px-2 pt-1.5 pb-0.5 font-medium text-muted-foreground text-xs first:border-t-0'>
                        {group.blockName}
                      </div>
                      <div>
                        {group.tags.map((tag: string) => {
                          const tagIndex = tagIndexMap.get(tag) ?? -1

                          // Handle display text based on tag type
                          let displayText: string
                          let tagDescription = ''
                          let tagIcon = group.blockName.charAt(0).toUpperCase()

                          if (
                            (group.blockType === 'loop' || group.blockType === 'parallel') &&
                            !tag.includes('.')
                          ) {
                            // Contextual tags like 'index', 'currentItem', 'items'
                            displayText = tag
                            if (tag === 'index') {
                              tagIcon = '#'
                              tagDescription = 'Index'
                            } else if (tag === 'currentItem') {
                              tagIcon = 'i'
                              tagDescription = 'Current item'
                            } else if (tag === 'items') {
                              tagIcon = 'I'
                              tagDescription = 'All items'
                            }
                          } else {
                            // Regular block output tags like 'blockname.field' or 'blockname.results'
                            const tagParts = tag.split('.')
                            const path = tagParts.slice(1).join('.')
                            displayText = path || group.blockName
                            if (path === 'results') {
                              tagDescription = 'Results array'
                            }
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
                                handleTagSelect(tag, group)
                              }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleTagSelect(tag, group)
                              }}
                            >
                              <div
                                className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
                                style={{ backgroundColor: blockColor }}
                              >
                                <span className='h-3 w-3 font-bold text-white text-xs'>
                                  {tagIcon}
                                </span>
                              </div>
                              <span className='flex-1 truncate'>{displayText}</span>
                              {tagDescription && (
                                <span className='ml-auto text-muted-foreground text-xs'>
                                  {tagDescription}
                                </span>
                              )}
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
