import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
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
import { getTool } from '@/tools/utils'
import { getTriggersByProvider } from '@/triggers'

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
      // Check if this is our new format with type and description
      if ('type' in value && typeof value.type === 'string') {
        // New format: { type: 'string', description: '...' } - treat as leaf node
        paths.push(currentPath)
      } else {
        // Legacy nested object - recurse
        const subPaths = generateOutputPaths(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      // Fallback - add the path
      paths.push(currentPath)
    }
  }

  return paths
}

// Generate output paths with type information
const generateOutputPathsWithTypes = (
  outputs: Record<string, any>,
  prefix = ''
): Array<{ path: string; type: string }> => {
  const paths: Array<{ path: string; type: string }> = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      // Simple type like 'string', 'number', 'json', 'any'
      paths.push({ path: currentPath, type: value })
    } else if (typeof value === 'object' && value !== null) {
      // Check if this is our new format with type and description
      if ('type' in value && typeof value.type === 'string') {
        // Handle nested properties for arrays and objects
        if (value.type === 'array' && value.items?.properties) {
          // For arrays with properties, add the array itself and recurse into items
          paths.push({ path: currentPath, type: 'array' })
          const subPaths = generateOutputPathsWithTypes(value.items.properties, currentPath)
          paths.push(...subPaths)
        } else if (value.type === 'object' && value.properties) {
          // For objects with properties, add the object itself and recurse into properties
          paths.push({ path: currentPath, type: 'object' })
          const subPaths = generateOutputPathsWithTypes(value.properties, currentPath)
          paths.push(...subPaths)
        } else {
          // Leaf node - just add the type
          paths.push({ path: currentPath, type: value.type })
        }
      } else {
        // Legacy nested object - recurse and assume 'object' type
        const subPaths = generateOutputPathsWithTypes(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      // Fallback - add with 'any' type
      paths.push({ path: currentPath, type: 'any' })
    }
  }

  return paths
}

// Generate output paths from tool configuration outputs
const generateToolOutputPaths = (blockConfig: any, operation: string): string[] => {
  if (!blockConfig?.tools?.config?.tool) return []

  try {
    // Get the tool ID for this operation
    const toolId = blockConfig.tools.config.tool({ operation })
    if (!toolId) return []

    // Get the tool configuration
    const toolConfig = getTool(toolId)
    if (!toolConfig?.outputs) return []

    // Generate paths from tool outputs
    return generateOutputPaths(toolConfig.outputs)
  } catch (error) {
    console.warn('Failed to get tool outputs for operation:', operation, error)
    return []
  }
}

// Get type information for a specific path from tool configuration outputs
const getToolOutputType = (blockConfig: any, operation: string, path: string): string => {
  if (!blockConfig?.tools?.config?.tool) return 'any'

  try {
    // Get the tool ID for this operation
    const toolId = blockConfig.tools.config.tool({ operation })
    if (!toolId) return 'any'

    // Get the tool configuration
    const toolConfig = getTool(toolId)
    if (!toolConfig?.outputs) return 'any'

    // Generate paths with types from tool outputs
    const pathsWithTypes = generateOutputPathsWithTypes(toolConfig.outputs)

    // Find the matching path and return its type
    const matchingPath = pathsWithTypes.find((p) => p.path === path)
    return matchingPath?.type || 'any'
  } catch (error) {
    console.warn('Failed to get tool output type for path:', path, error)
    return 'any'
  }
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
  const [hoveredNested, setHoveredNested] = useState<{ tag: string; index: number } | null>(null)
  const [inSubmenu, setInSubmenu] = useState(false)
  const [submenuIndex, setSubmenuIndex] = useState(0)
  const [parentHovered, setParentHovered] = useState<string | null>(null)
  const [submenuHovered, setSubmenuHovered] = useState(false)

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

      // Special handling for evaluator blocks
      if (sourceBlock.type === 'evaluator') {
        // Get the evaluation metrics for the evaluator block
        const metricsValue = useSubBlockStore.getState().getValue(activeSourceBlockId, 'metrics')

        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          // Use the metric names as the available outputs
          const validMetrics = metricsValue.filter((metric: any) => metric?.name)
          blockTags = validMetrics.map(
            (metric: any) => `${normalizedBlockName}.${metric.name.toLowerCase()}`
          )
        } else {
          // Fallback to default evaluator outputs if no metrics are defined
          const outputPaths = generateOutputPaths(blockConfig.outputs)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (responseFormat) {
        // Use custom schema properties if response format is specified
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          // Fallback to default if schema extraction failed
          const outputPaths = generateOutputPaths(blockConfig.outputs || {})
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (!blockConfig.outputs || Object.keys(blockConfig.outputs).length === 0) {
        // Handle blocks with no outputs (like starter) - check for custom input fields
        if (sourceBlock.type === 'starter') {
          // Check what start workflow mode is selected
          const startWorkflowValue = useSubBlockStore
            .getState()
            .getValue(activeSourceBlockId, 'startWorkflow')

          if (startWorkflowValue === 'chat') {
            // For chat mode, provide input, conversationId, and files
            blockTags = [
              `${normalizedBlockName}.input`,
              `${normalizedBlockName}.conversationId`,
              `${normalizedBlockName}.files`,
            ]
          } else {
            // Check for custom input format fields (for manual mode)
            const inputFormatValue = useSubBlockStore
              .getState()
              .getValue(activeSourceBlockId, 'inputFormat')

            if (
              inputFormatValue &&
              Array.isArray(inputFormatValue) &&
              inputFormatValue.length > 0
            ) {
              // Use custom input fields if they exist
              blockTags = inputFormatValue
                .filter((field: any) => field.name && field.name.trim() !== '')
                .map((field: any) => `${normalizedBlockName}.${field.name}`)
            } else {
              // Fallback to just the block name
              blockTags = [normalizedBlockName]
            }
          }
        } else {
          // Other blocks with no outputs - show as just <blockname>
          blockTags = [normalizedBlockName]
        }
      } else {
        // Check if block is in trigger mode and has trigger outputs
        if (sourceBlock?.triggerMode && blockConfig.triggers?.enabled) {
          // Get trigger outputs for this block's provider
          const triggers = getTriggersByProvider(sourceBlock.type) // Use block type as provider
          const firstTrigger = triggers[0] // Use first available trigger for this provider

          if (firstTrigger?.outputs) {
            // Use trigger outputs instead of block outputs
            const outputPaths = generateOutputPaths(firstTrigger.outputs)
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            // Fallback to default block outputs if no trigger outputs
            const outputPaths = generateOutputPaths(blockConfig.outputs || {})
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        } else {
          // Check for tool-specific outputs first
          const operationValue = useSubBlockStore
            .getState()
            .getValue(activeSourceBlockId, 'operation')
          const toolOutputPaths = operationValue
            ? generateToolOutputPaths(blockConfig, operationValue)
            : []

          if (toolOutputPaths.length > 0) {
            // Use tool-specific outputs
            blockTags = toolOutputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            // Fallback to default block outputs
            const outputPaths = generateOutputPaths(blockConfig.outputs || {})
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        }
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

      // Special handling for evaluator blocks
      if (accessibleBlock.type === 'evaluator') {
        // Get the evaluation metrics for the evaluator block
        const metricsValue = useSubBlockStore.getState().getValue(accessibleBlockId, 'metrics')

        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          // Use the metric names as the available outputs
          const validMetrics = metricsValue.filter((metric: any) => metric?.name)
          blockTags = validMetrics.map(
            (metric: any) => `${normalizedBlockName}.${metric.name.toLowerCase()}`
          )
        } else {
          // Fallback to default evaluator outputs if no metrics are defined
          const outputPaths = generateOutputPaths(blockConfig.outputs)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (responseFormat) {
        // Use custom schema properties if response format is specified
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          // Fallback to default if schema extraction failed
          const outputPaths = generateOutputPaths(blockConfig.outputs || {})
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (!blockConfig.outputs || Object.keys(blockConfig.outputs).length === 0) {
        // Handle blocks with no outputs (like starter) - check for custom input fields
        if (accessibleBlock.type === 'starter') {
          // Check what start workflow mode is selected
          const startWorkflowValue = useSubBlockStore
            .getState()
            .getValue(accessibleBlockId, 'startWorkflow')

          if (startWorkflowValue === 'chat') {
            // For chat mode, provide input, conversationId, and files
            blockTags = [
              `${normalizedBlockName}.input`,
              `${normalizedBlockName}.conversationId`,
              `${normalizedBlockName}.files`,
            ]
          } else {
            // Check for custom input format fields (for manual mode)
            const inputFormatValue = useSubBlockStore
              .getState()
              .getValue(accessibleBlockId, 'inputFormat')

            if (
              inputFormatValue &&
              Array.isArray(inputFormatValue) &&
              inputFormatValue.length > 0
            ) {
              // Use custom input fields if they exist
              blockTags = inputFormatValue
                .filter((field: any) => field.name && field.name.trim() !== '')
                .map((field: any) => `${normalizedBlockName}.${field.name}`)
            } else {
              // Fallback to just the block name
              blockTags = [normalizedBlockName]
            }
          }
        } else {
          // Other blocks with no outputs - show as just <blockname>
          blockTags = [normalizedBlockName]
        }
      } else {
        // Check if block is in trigger mode and has trigger outputs
        const blockState = blocks[accessibleBlockId]
        if (blockState?.triggerMode && blockConfig.triggers?.enabled) {
          // Get trigger outputs for this block's provider
          const triggers = getTriggersByProvider(blockState.type) // Use block type as provider
          const firstTrigger = triggers[0] // Use first available trigger for this provider

          if (firstTrigger?.outputs) {
            // Use trigger outputs instead of block outputs
            const outputPaths = generateOutputPaths(firstTrigger.outputs)
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            // Fallback to default block outputs if no trigger outputs
            const outputPaths = generateOutputPaths(blockConfig.outputs || {})
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        } else {
          // Check for tool-specific outputs first
          const operationValue = useSubBlockStore
            .getState()
            .getValue(accessibleBlockId, 'operation')
          const toolOutputPaths = operationValue
            ? generateToolOutputPaths(blockConfig, operationValue)
            : []

          if (toolOutputPaths.length > 0) {
            // Use tool-specific outputs
            blockTags = toolOutputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            // Fallback to default block outputs
            const outputPaths = generateOutputPaths(blockConfig.outputs || {})
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        }
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

  // Create nested structure for tags with dot notation
  const nestedBlockTagGroups = useMemo(() => {
    return filteredBlockTagGroups.map((group) => {
      const nestedTags: Array<{
        key: string
        display: string
        fullTag?: string
        children?: Array<{ key: string; display: string; fullTag: string }>
      }> = []

      // Group tags by their parent path
      const groupedTags: Record<
        string,
        Array<{ key: string; display: string; fullTag: string }>
      > = {}
      const directTags: Array<{ key: string; display: string; fullTag: string }> = []

      group.tags.forEach((tag) => {
        const tagParts = tag.split('.')
        if (tagParts.length >= 3) {
          // e.g., "gmail1.email.id" -> blockName: "gmail1", parent: "email", child: "id"
          const parent = tagParts[1] // "email"
          const child = tagParts.slice(2).join('.') // "id" or "nested.property"

          if (!groupedTags[parent]) {
            groupedTags[parent] = []
          }
          groupedTags[parent].push({
            key: `${parent}.${child}`,
            display: child,
            fullTag: tag,
          })
        } else {
          // Direct tags without nested structure
          const path = tagParts.slice(1).join('.')
          directTags.push({
            key: path || group.blockName,
            display: path || group.blockName,
            fullTag: tag,
          })
        }
      })

      // Add grouped tags (with children)
      Object.entries(groupedTags).forEach(([parent, children]) => {
        nestedTags.push({
          key: parent,
          display: parent,
          children: children,
        })
      })

      // Add direct tags
      directTags.forEach((directTag) => {
        nestedTags.push(directTag)
      })

      return {
        ...group,
        nestedTags,
      }
    })
  }, [filteredBlockTagGroups])

  // Create ordered tags for keyboard navigation that matches the visual structure
  const orderedTags = useMemo(() => {
    const visualTags: string[] = []

    // Add variable tags first
    visualTags.push(...variableTags)

    // Add nested block tags in visual order
    nestedBlockTagGroups.forEach((group) => {
      group.nestedTags.forEach((nestedTag) => {
        if (nestedTag.children && nestedTag.children.length > 0) {
          // For parent items with children, use the first child's fullTag as a representative
          // This allows keyboard navigation to land on the parent item
          const firstChild = nestedTag.children[0]
          if (firstChild.fullTag) {
            visualTags.push(firstChild.fullTag)
          }
        } else if (nestedTag.fullTag) {
          // For direct items without children
          visualTags.push(nestedTag.fullTag)
        }
      })
    })

    return visualTags
  }, [variableTags, nestedBlockTagGroups])

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

        if (inSubmenu) {
          // Handle keyboard navigation within submenu
          const currentHovered = hoveredNested
          if (!currentHovered) {
            setInSubmenu(false)
            return
          }

          // Find the current nested group and its children
          const currentGroup = nestedBlockTagGroups.find((group) => {
            return group.nestedTags.some(
              (tag, index) =>
                `${group.blockId}-${tag.key}` === currentHovered.tag &&
                index === currentHovered.index
            )
          })

          const currentNestedTag = currentGroup?.nestedTags.find(
            (tag, index) =>
              `${currentGroup.blockId}-${tag.key}` === currentHovered.tag &&
              index === currentHovered.index
          )

          const children = currentNestedTag?.children || []

          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              e.stopPropagation()
              setSubmenuIndex((prev) => Math.min(prev + 1, children.length - 1))
              break
            case 'ArrowUp':
              e.preventDefault()
              e.stopPropagation()
              setSubmenuIndex((prev) => Math.max(prev - 1, 0))
              break
            case 'ArrowLeft':
              e.preventDefault()
              e.stopPropagation()
              setInSubmenu(false)
              setHoveredNested(null)
              setSubmenuIndex(0)
              break
            case 'Enter':
              e.preventDefault()
              e.stopPropagation()
              if (submenuIndex >= 0 && submenuIndex < children.length) {
                const selectedChild = children[submenuIndex]
                handleTagSelect(selectedChild.fullTag, currentGroup)
              }
              break
            case 'Escape':
              e.preventDefault()
              e.stopPropagation()
              setInSubmenu(false)
              setHoveredNested(null)
              setSubmenuIndex(0)
              break
          }
        } else {
          // Handle keyboard navigation in main menu
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              e.stopPropagation()
              setSelectedIndex((prev) => {
                const newIndex = Math.min(prev + 1, orderedTags.length - 1)
                // Check if the new selected item is a parent with children and show hover
                const newSelectedTag = orderedTags[newIndex]
                let foundParent = false
                for (const group of nestedBlockTagGroups) {
                  for (
                    let nestedTagIndex = 0;
                    nestedTagIndex < group.nestedTags.length;
                    nestedTagIndex++
                  ) {
                    const nestedTag = group.nestedTags[nestedTagIndex]
                    if (nestedTag.children && nestedTag.children.length > 0) {
                      const firstChild = nestedTag.children[0]
                      if (firstChild.fullTag === newSelectedTag) {
                        setHoveredNested({
                          tag: `${group.blockId}-${nestedTag.key}`,
                          index: nestedTagIndex,
                        })
                        foundParent = true
                        break
                      }
                    }
                  }
                  if (foundParent) break
                }
                // Clear hover if not a parent item and user isn't actively in submenu
                if (!foundParent && !inSubmenu) {
                  setHoveredNested(null)
                }
                return newIndex
              })
              break
            case 'ArrowUp':
              e.preventDefault()
              e.stopPropagation()
              setSelectedIndex((prev) => {
                const newIndex = Math.max(prev - 1, 0)
                // Check if the new selected item is a parent with children and show hover
                const newSelectedTag = orderedTags[newIndex]
                let foundParent = false
                for (const group of nestedBlockTagGroups) {
                  for (
                    let nestedTagIndex = 0;
                    nestedTagIndex < group.nestedTags.length;
                    nestedTagIndex++
                  ) {
                    const nestedTag = group.nestedTags[nestedTagIndex]
                    if (nestedTag.children && nestedTag.children.length > 0) {
                      const firstChild = nestedTag.children[0]
                      if (firstChild.fullTag === newSelectedTag) {
                        setHoveredNested({
                          tag: `${group.blockId}-${nestedTag.key}`,
                          index: nestedTagIndex,
                        })
                        foundParent = true
                        break
                      }
                    }
                  }
                  if (foundParent) break
                }
                // Clear hover if not a parent item and user isn't actively in submenu
                if (!foundParent && !inSubmenu) {
                  setHoveredNested(null)
                }
                return newIndex
              })
              break
            case 'ArrowRight':
              e.preventDefault()
              e.stopPropagation()
              // Check if current item has children
              if (selectedIndex >= 0 && selectedIndex < orderedTags.length) {
                const selectedTag = orderedTags[selectedIndex]
                // Find which nested group this belongs to by checking if the selected tag
                // is the first child of a parent with multiple children
                for (const group of nestedBlockTagGroups) {
                  for (
                    let nestedTagIndex = 0;
                    nestedTagIndex < group.nestedTags.length;
                    nestedTagIndex++
                  ) {
                    const nestedTag = group.nestedTags[nestedTagIndex]
                    if (nestedTag.children && nestedTag.children.length > 0) {
                      // Check if the selected tag is the first child (representative) of this parent
                      const firstChild = nestedTag.children[0]
                      if (firstChild.fullTag === selectedTag) {
                        // Enter submenu
                        setInSubmenu(true)
                        setSubmenuIndex(0)
                        setHoveredNested({
                          tag: `${group.blockId}-${nestedTag.key}`,
                          index: nestedTagIndex,
                        })
                        return
                      }
                    }
                  }
                }
              }
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
      }

      window.addEventListener('keydown', handleKeyboardEvent, true)
      return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
    }
  }, [
    visible,
    selectedIndex,
    orderedTags,
    filteredBlockTagGroups,
    nestedBlockTagGroups,
    handleTagSelect,
    onClose,
    inSubmenu,
    submenuIndex,
    hoveredNested,
  ])

  // Early return if dropdown should not be visible
  if (!visible || tags.length === 0 || orderedTags.length === 0) return null

  return (
    <div
      className={cn(
        'absolute z-[9999] mt-1 w-full overflow-visible rounded-md border bg-popover shadow-md',
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
                        onMouseEnter={() => {
                          setSelectedIndex(tagIndex >= 0 ? tagIndex : 0)
                          // Clear nested hover when hovering over regular items
                          setHoveredNested(null)
                        }}
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

            {/* Block sections with nested structure */}
            {nestedBlockTagGroups.length > 0 && (
              <>
                {variableTags.length > 0 && <div className='my-0' />}
                {nestedBlockTagGroups.map((group) => {
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
                    <div key={group.blockId} className='relative'>
                      <div className='border-t px-2 pt-1.5 pb-0.5 font-medium text-muted-foreground text-xs first:border-t-0'>
                        {group.blockName}
                      </div>
                      <div>
                        {group.nestedTags.map((nestedTag, index) => {
                          const tagIndex = nestedTag.fullTag
                            ? (tagIndexMap.get(nestedTag.fullTag) ?? -1)
                            : -1
                          const hasChildren = nestedTag.children && nestedTag.children.length > 0
                          const isHovered =
                            hoveredNested?.tag === `${group.blockId}-${nestedTag.key}` &&
                            hoveredNested?.index === index

                          // Handle display text and icon
                          const displayText = nestedTag.display
                          let tagDescription = ''
                          let tagIcon = group.blockName.charAt(0).toUpperCase()

                          if (
                            (group.blockType === 'loop' || group.blockType === 'parallel') &&
                            !nestedTag.key.includes('.')
                          ) {
                            // Contextual tags like 'index', 'currentItem', 'items'
                            if (nestedTag.key === 'index') {
                              tagIcon = '#'
                              tagDescription = 'number'
                            } else if (nestedTag.key === 'currentItem') {
                              tagIcon = 'i'
                              tagDescription = 'any'
                            } else if (nestedTag.key === 'items') {
                              tagIcon = 'I'
                              tagDescription = 'array'
                            }
                          } else {
                            // Get type from tool configuration if available
                            if (nestedTag.fullTag) {
                              // Extract the output path (remove block name prefix)
                              const tagParts = nestedTag.fullTag.split('.')
                              const outputPath = tagParts.slice(1).join('.')

                              // Try to get type from tool configuration using the same mechanism as tag generation
                              const block = Object.values(blocks).find(
                                (b) => b.id === group.blockId
                              )
                              if (block) {
                                const blockConfig = getBlock(block.type)
                                const operationValue = useSubBlockStore
                                  .getState()
                                  .getValue(group.blockId, 'operation')

                                if (blockConfig && operationValue) {
                                  const toolType = getToolOutputType(
                                    blockConfig,
                                    operationValue,
                                    outputPath
                                  )
                                  tagDescription = toolType
                                }
                              }
                            }
                          }

                          // Check if this item is keyboard selected (for parent items with children)
                          const isKeyboardSelected = (() => {
                            if (
                              hasChildren &&
                              selectedIndex >= 0 &&
                              selectedIndex < orderedTags.length
                            ) {
                              const selectedTag = orderedTags[selectedIndex]
                              // Check if the selected tag is the first child of this parent
                              const firstChild = nestedTag.children?.[0]
                              return firstChild?.fullTag === selectedTag
                            }
                            return tagIndex === selectedIndex && tagIndex >= 0
                          })()

                          return (
                            <div
                              key={`${group.blockId}-${nestedTag.key}-${index}`}
                              className='relative'
                            >
                              <button
                                className={cn(
                                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                  'hover:bg-accent hover:text-accent-foreground',
                                  'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                                  isKeyboardSelected && 'bg-accent text-accent-foreground'
                                )}
                                onMouseEnter={() => {
                                  if (tagIndex >= 0) {
                                    setSelectedIndex(tagIndex)
                                  }

                                  if (hasChildren) {
                                    const parentKey = `${group.blockId}-${nestedTag.key}`
                                    setParentHovered(parentKey)
                                    setHoveredNested({
                                      tag: parentKey,
                                      index,
                                    })
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (hasChildren) {
                                    const parentKey = `${group.blockId}-${nestedTag.key}`
                                    setParentHovered(null)
                                    // Only hide submenu if not hovering over submenu
                                    if (!submenuHovered) {
                                      setHoveredNested(null)
                                    }
                                  }
                                }}
                                onMouseDown={(e) => {
                                  if (nestedTag.fullTag) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleTagSelect(nestedTag.fullTag, group)
                                  } else if (hasChildren) {
                                    // Prevent default but don't select for parent items
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }
                                }}
                                onClick={(e) => {
                                  if (nestedTag.fullTag) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleTagSelect(nestedTag.fullTag, group)
                                  } else if (hasChildren) {
                                    // Prevent default but don't select for parent items
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }
                                }}
                                disabled={false}
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
                                {hasChildren && (
                                  <ChevronRight className='h-4 w-4 text-muted-foreground' />
                                )}
                                {tagDescription && !hasChildren && (
                                  <span className='ml-auto text-muted-foreground text-xs'>
                                    {tagDescription}
                                  </span>
                                )}
                              </button>

                              {/* Nested submenu */}
                              {hasChildren && isHovered && (
                                <div
                                  className='absolute top-0 left-full z-[10000] ml-0.5 min-w-[200px] max-w-[300px] rounded-md border border-border bg-background shadow-lg'
                                  onMouseEnter={() => {
                                    setSubmenuHovered(true)
                                    const parentKey = `${group.blockId}-${nestedTag.key}`
                                    setHoveredNested({
                                      tag: parentKey,
                                      index,
                                    })
                                    // Initialize submenu index to -1 to avoid highlighting multiple items
                                    setSubmenuIndex(-1)
                                  }}
                                  onMouseLeave={() => {
                                    setSubmenuHovered(false)
                                    // Only hide if parent is also not hovered
                                    const parentKey = `${group.blockId}-${nestedTag.key}`
                                    if (parentHovered !== parentKey) {
                                      setHoveredNested(null)
                                    }
                                  }}
                                >
                                  <div className='py-1'>
                                    {nestedTag.children!.map((child, childIndex) => {
                                      const childTagIndex = tagIndexMap.get(child.fullTag) ?? -1
                                      // Simple highlighting: either keyboard OR mouse, not both
                                      const isKeyboardSelected =
                                        inSubmenu && submenuIndex === childIndex
                                      const isSelected = isKeyboardSelected

                                      // Get type for child element
                                      let childType = ''
                                      const childTagParts = child.fullTag.split('.')
                                      const childOutputPath = childTagParts.slice(1).join('.')

                                      // Try to get type from tool configuration using the same mechanism as tag generation
                                      const block = Object.values(blocks).find(
                                        (b) => b.id === group.blockId
                                      )
                                      if (block) {
                                        const blockConfig = getBlock(block.type)
                                        const operationValue = useSubBlockStore
                                          .getState()
                                          .getValue(group.blockId, 'operation')

                                        if (blockConfig && operationValue) {
                                          childType = getToolOutputType(
                                            blockConfig,
                                            operationValue,
                                            childOutputPath
                                          )
                                        }
                                      }

                                      return (
                                        <button
                                          key={child.key}
                                          className={cn(
                                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                            'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                                            'transition-colors duration-150',
                                            isSelected
                                              ? 'bg-accent text-accent-foreground'
                                              : 'hover:bg-accent hover:text-accent-foreground'
                                          )}
                                          onMouseEnter={() => {
                                            // Sync submenu selection with mouse hover
                                            setSubmenuIndex(childIndex)
                                            setInSubmenu(true)
                                          }}
                                          onMouseDown={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleTagSelect(child.fullTag, group)
                                            setHoveredNested(null)
                                          }}
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleTagSelect(child.fullTag, group)
                                            setHoveredNested(null)
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
                                          <span className='flex-1 truncate'>{child.display}</span>
                                          {childType && (
                                            <span className='ml-auto text-muted-foreground text-xs'>
                                              {childType}
                                            </span>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
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
