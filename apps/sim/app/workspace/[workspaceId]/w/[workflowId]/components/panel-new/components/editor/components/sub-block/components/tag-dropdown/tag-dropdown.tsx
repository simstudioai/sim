import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import {
  Popover,
  PopoverAnchor,
  PopoverBackButton,
  PopoverContent,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  usePopoverContext,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { cn } from '@/lib/utils'
import { getBlockOutputPaths, getBlockOutputType } from '@/lib/workflows/block-outputs'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTool } from '@/tools/utils'
import { KeyboardNavigationHandler } from './components/keyboard-navigation-handler'
import type { BlockTagGroup, NestedBlockTagGroup, NestedTag } from './types'

const logger = createLogger('TagDropdown')

/**
 * Props for the TagDropdown component
 */
interface TagDropdownProps {
  /** Whether the dropdown is visible */
  visible: boolean
  /** Callback when a tag is selected */
  onSelect: (newValue: string) => void
  /** ID of the block that owns the input field */
  blockId: string
  /** ID of the specific source block being referenced, if any */
  activeSourceBlockId: string | null
  /** Additional CSS class names */
  className?: string
  /** Current value of the input field */
  inputValue: string
  /** Current cursor position in the input */
  cursorPosition: number
  /** Callback when the dropdown should close */
  onClose?: () => void
  /** Custom styles for positioning */
  style?: React.CSSProperties
  /** Reference to the input element for caret positioning */
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement>
}

/**
 * Checks if the tag trigger (<) should show the tag dropdown
 * @param text - The full text content
 * @param cursorPosition - Current cursor position
 * @returns Object indicating whether to show the dropdown
 */
export const checkTagTrigger = (text: string, cursorPosition: number): { show: boolean } => {
  if (cursorPosition >= 1) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    const lastCloseBracket = textBeforeCursor.lastIndexOf('>')

    if (lastOpenBracket !== -1 && (lastCloseBracket === -1 || lastCloseBracket < lastOpenBracket)) {
      return { show: true }
    }
  }
  return { show: false }
}

export const getTagSearchTerm = (text: string, cursorPosition: number): string => {
  if (cursorPosition <= 0) {
    return ''
  }

  const textBeforeCursor = text.slice(0, cursorPosition)
  const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

  if (lastOpenBracket === -1) {
    return ''
  }

  const lastCloseBracket = textBeforeCursor.lastIndexOf('>')

  if (lastCloseBracket > lastOpenBracket) {
    return ''
  }

  return textBeforeCursor.slice(lastOpenBracket + 1).toLowerCase()
}

const BLOCK_COLORS = {
  VARIABLE: '#2F8BFF',
  DEFAULT: '#2F55FF',
  LOOP: '#2FB3FF',
  PARALLEL: '#FEE12B',
} as const

const TAG_PREFIXES = {
  VARIABLE: 'variable.',
} as const

/**
 * Normalizes a block name by removing spaces and converting to lowercase
 */
const normalizeBlockName = (blockName: string): string => {
  return blockName.replace(/\s+/g, '').toLowerCase()
}

/**
 * Normalizes a variable name by removing spaces
 */
const normalizeVariableName = (variableName: string): string => {
  return variableName.replace(/\s+/g, '')
}

/**
 * Ensures the root tag is present in the tags array
 */
const ensureRootTag = (tags: string[], rootTag: string): string[] => {
  if (!rootTag) return tags
  if (tags.includes(rootTag)) return tags
  return [rootTag, ...tags]
}

/**
 * Gets a subblock value from the store
 */
const getSubBlockValue = (blockId: string, property: string): any => {
  return useSubBlockStore.getState().getValue(blockId, property)
}

/**
 * Gets the output type for a specific path in a block's outputs
 */
const getOutputTypeForPath = (
  block: BlockState,
  blockConfig: BlockConfig | null,
  blockId: string,
  outputPath: string,
  mergedSubBlocksOverride?: Record<string, any>
): string => {
  if (block?.triggerMode && blockConfig?.triggers?.enabled) {
    return getBlockOutputType(block.type, outputPath, mergedSubBlocksOverride, true)
  }
  if (block?.type === 'starter') {
    const startWorkflowValue =
      mergedSubBlocksOverride?.startWorkflow?.value ?? getSubBlockValue(blockId, 'startWorkflow')

    if (startWorkflowValue === 'chat') {
      const chatModeTypes: Record<string, string> = {
        input: 'string',
        conversationId: 'string',
        files: 'files',
      }
      return chatModeTypes[outputPath] || 'any'
    }
    const inputFormatValue =
      mergedSubBlocksOverride?.inputFormat?.value ?? getSubBlockValue(blockId, 'inputFormat')
    if (inputFormatValue && Array.isArray(inputFormatValue)) {
      const field = inputFormatValue.find(
        (f: { name?: string; type?: string }) => f.name === outputPath
      )
      if (field?.type) return field.type
    }
  } else if (blockConfig?.category === 'triggers') {
    const blockState = useWorkflowStore.getState().blocks[blockId]
    const subBlocks = mergedSubBlocksOverride ?? (blockState?.subBlocks || {})
    return getBlockOutputType(block.type, outputPath, subBlocks)
  } else {
    const operationValue = getSubBlockValue(blockId, 'operation')
    if (blockConfig && operationValue) {
      return getToolOutputType(blockConfig, operationValue, outputPath)
    }
  }
  return 'any'
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
 * Recursively generates all output paths with their types from an outputs schema
 */
const generateOutputPathsWithTypes = (
  outputs: Record<string, any>,
  prefix = ''
): Array<{ path: string; type: string }> => {
  const paths: Array<{ path: string; type: string }> = []

  for (const [key, value] of Object.entries(outputs)) {
    const currentPath = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      paths.push({ path: currentPath, type: value })
    } else if (typeof value === 'object' && value !== null) {
      if ('type' in value && typeof value.type === 'string') {
        if (value.type === 'array' && value.items?.properties) {
          paths.push({ path: currentPath, type: 'array' })
          const subPaths = generateOutputPathsWithTypes(value.items.properties, currentPath)
          paths.push(...subPaths)
        } else if (value.type === 'object' && value.properties) {
          paths.push({ path: currentPath, type: 'object' })
          const subPaths = generateOutputPathsWithTypes(value.properties, currentPath)
          paths.push(...subPaths)
        } else {
          paths.push({ path: currentPath, type: value.type })
        }
      } else {
        const subPaths = generateOutputPathsWithTypes(value, currentPath)
        paths.push(...subPaths)
      }
    } else {
      paths.push({ path: currentPath, type: 'any' })
    }
  }

  return paths
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
  } catch (error) {
    logger.warn('Failed to get tool outputs for operation', { operation, error })
    return []
  }
}

/**
 * Gets the output type for a specific path in a tool's outputs
 */
const getToolOutputType = (blockConfig: BlockConfig, operation: string, path: string): string => {
  if (!blockConfig?.tools?.config?.tool) return 'any'

  try {
    const toolId = blockConfig.tools.config.tool({ operation })
    if (!toolId) return 'any'

    const toolConfig = getTool(toolId)
    if (!toolConfig?.outputs) return 'any'

    const pathsWithTypes = generateOutputPathsWithTypes(toolConfig.outputs)
    const matchingPath = pathsWithTypes.find((p) => p.path === path)
    return matchingPath?.type || 'any'
  } catch (error) {
    logger.warn('Failed to get tool output type for path', { path, error })
    return 'any'
  }
}

/**
 * Calculates the viewport position of the caret in a textarea/input
 */
const getCaretViewportPosition = (
  element: HTMLTextAreaElement | HTMLInputElement,
  caretPosition: number,
  text: string
) => {
  const elementRect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  const mirrorDiv = document.createElement('div')
  mirrorDiv.style.position = 'absolute'
  mirrorDiv.style.visibility = 'hidden'
  mirrorDiv.style.whiteSpace = 'pre-wrap'
  mirrorDiv.style.wordWrap = 'break-word'
  mirrorDiv.style.font = style.font
  mirrorDiv.style.padding = style.padding
  mirrorDiv.style.border = style.border
  mirrorDiv.style.width = style.width
  mirrorDiv.style.lineHeight = style.lineHeight
  mirrorDiv.style.boxSizing = style.boxSizing
  mirrorDiv.style.letterSpacing = style.letterSpacing
  mirrorDiv.style.textTransform = style.textTransform
  mirrorDiv.style.textIndent = style.textIndent
  mirrorDiv.style.textAlign = style.textAlign

  mirrorDiv.textContent = text.substring(0, caretPosition)

  const caretMarker = document.createElement('span')
  caretMarker.style.display = 'inline-block'
  caretMarker.style.width = '0px'
  caretMarker.style.padding = '0'
  caretMarker.style.border = '0'
  mirrorDiv.appendChild(caretMarker)

  document.body.appendChild(mirrorDiv)
  const markerRect = caretMarker.getBoundingClientRect()
  const mirrorRect = mirrorDiv.getBoundingClientRect()
  document.body.removeChild(mirrorDiv)

  const leftOffset = markerRect.left - mirrorRect.left - element.scrollLeft
  const topOffset = markerRect.top - mirrorRect.top - element.scrollTop

  return {
    left: elementRect.left + leftOffset,
    top: elementRect.top + topOffset,
  }
}

/**
 * Renders a tag icon with background color
 */
const TagIcon: React.FC<{ icon: string; color: string }> = ({ icon, color }) => (
  <div
    className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded'
    style={{ backgroundColor: color }}
  >
    <span className='font-bold text-[10px] text-white'>{icon}</span>
  </div>
)

/**
 * Wrapper for PopoverBackButton that handles parent tag navigation
 */
const TagDropdownBackButton: React.FC<{
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  flatTagList: Array<{ tag: string; group?: BlockTagGroup }>
  nestedBlockTagGroups: NestedBlockTagGroup[]
  itemRefs: React.MutableRefObject<Map<number, HTMLElement>>
}> = ({ selectedIndex, setSelectedIndex, flatTagList, nestedBlockTagGroups, itemRefs }) => {
  const { currentFolder } = usePopoverContext()

  // Find parent tag info for current folder
  const parentTagInfo = useMemo(() => {
    if (!currentFolder) return null

    for (const group of nestedBlockTagGroups) {
      for (const nestedTag of group.nestedTags) {
        const folderId = `${group.blockId}-${nestedTag.key}`
        if (folderId === currentFolder && nestedTag.parentTag) {
          const parentIdx = flatTagList.findIndex((item) => item.tag === nestedTag.parentTag)
          return parentIdx >= 0 ? { index: parentIdx } : null
        }
      }
    }
    return null
  }, [currentFolder, nestedBlockTagGroups, flatTagList])

  if (!parentTagInfo) {
    return <PopoverBackButton />
  }

  const isActive = parentTagInfo.index === selectedIndex

  return (
    <PopoverBackButton
      folderTitleRef={(el) => {
        if (el) {
          itemRefs.current.set(parentTagInfo.index, el)
        }
      }}
      folderTitleActive={isActive}
      onFolderTitleMouseEnter={() => {
        setSelectedIndex(parentTagInfo.index)
      }}
    />
  )
}

/**
 * TagDropdown component that displays available tags (variables and block outputs)
 * for selection in input fields. Uses the Popover component system for consistent styling.
 */
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
  inputRef,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())

  const { blocks, edges, loops, parallels } = useWorkflowStore(
    (state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    }),
    shallow
  )

  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const rawAccessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const combinedAccessiblePrefixes = useMemo(() => {
    if (!rawAccessiblePrefixes) return new Set<string>()
    return new Set<string>(rawAccessiblePrefixes)
  }, [rawAccessiblePrefixes])

  const workflowSubBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  const getMergedSubBlocks = useCallback(
    (targetBlockId: string): Record<string, any> => {
      const base = blocks[targetBlockId]?.subBlocks || {}
      const live = workflowSubBlockValues?.[targetBlockId] || {}
      const merged: Record<string, any> = { ...base }
      for (const [subId, liveVal] of Object.entries(live)) {
        merged[subId] = { ...(base[subId] || {}), value: liveVal }
      }
      return merged
    },
    [blocks, workflowSubBlockValues]
  )

  const getVariablesByWorkflowId = useVariablesStore((state) => state.getVariablesByWorkflowId)
  const workflowVariables = workflowId ? getVariablesByWorkflowId(workflowId) : []

  const searchTerm = useMemo(
    () => getTagSearchTerm(inputValue, cursorPosition),
    [inputValue, cursorPosition]
  )

  /**
   * Computes tags, variable info, and block tag groups
   */
  const { tags, variableInfoMap, blockTagGroups } = useMemo(() => {
    if (activeSourceBlockId) {
      const sourceBlock = blocks[activeSourceBlockId]
      if (!sourceBlock) {
        return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
      }

      const blockConfig = getBlock(sourceBlock.type)

      if (!blockConfig) {
        if (sourceBlock.type === 'loop' || sourceBlock.type === 'parallel') {
          const mockConfig = { outputs: { results: 'array' } }
          const blockName = sourceBlock.name || sourceBlock.type
          const normalizedBlockName = normalizeBlockName(blockName)

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

          return { tags: blockTags, variableInfoMap: {}, blockTagGroups }
        }
        return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
      }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = normalizeBlockName(blockName)

      const mergedSubBlocks = getMergedSubBlocks(activeSourceBlockId)
      const responseFormatValue = mergedSubBlocks?.responseFormat?.value
      const responseFormat = parseResponseFormatSafely(responseFormatValue, activeSourceBlockId)

      let blockTags: string[]

      if (sourceBlock.type === 'evaluator') {
        const metricsValue = getSubBlockValue(activeSourceBlockId, 'metrics')

        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const validMetrics = metricsValue.filter((metric: { name?: string }) => metric?.name)
          blockTags = validMetrics.map(
            (metric: { name: string }) => `${normalizedBlockName}.${metric.name.toLowerCase()}`
          )
        } else {
          const outputPaths = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (sourceBlock.type === 'variables') {
        const variablesValue = getSubBlockValue(activeSourceBlockId, 'variables')

        if (variablesValue && Array.isArray(variablesValue) && variablesValue.length > 0) {
          const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
            assignment?.variableName?.trim()
          )
          blockTags = validAssignments.map(
            (assignment: { variableName: string }) =>
              `${normalizedBlockName}.${assignment.variableName.trim()}`
          )
        } else {
          blockTags = [normalizedBlockName]
        }
      } else if (responseFormat) {
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          const outputPaths = getBlockOutputPaths(
            sourceBlock.type,
            mergedSubBlocks,
            sourceBlock.triggerMode
          )
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (!blockConfig.outputs || Object.keys(blockConfig.outputs).length === 0) {
        if (sourceBlock.type === 'starter') {
          const startWorkflowValue = mergedSubBlocks?.startWorkflow?.value

          if (startWorkflowValue === 'chat') {
            blockTags = [
              `${normalizedBlockName}.input`,
              `${normalizedBlockName}.conversationId`,
              `${normalizedBlockName}.files`,
            ]
          } else {
            const inputFormatValue = mergedSubBlocks?.inputFormat?.value

            if (
              inputFormatValue &&
              Array.isArray(inputFormatValue) &&
              inputFormatValue.length > 0
            ) {
              blockTags = inputFormatValue
                .filter((field: { name?: string }) => field.name && field.name.trim() !== '')
                .map((field: { name: string }) => `${normalizedBlockName}.${field.name}`)
            } else {
              blockTags = [normalizedBlockName]
            }
          }
        } else if (sourceBlock.type === 'api_trigger' || sourceBlock.type === 'input_trigger') {
          const inputFormatValue = mergedSubBlocks?.inputFormat?.value

          if (inputFormatValue && Array.isArray(inputFormatValue) && inputFormatValue.length > 0) {
            blockTags = inputFormatValue
              .filter((field: { name?: string }) => field.name && field.name.trim() !== '')
              .map((field: { name: string }) => `${normalizedBlockName}.${field.name}`)
          } else {
            blockTags = []
          }
        } else {
          blockTags = [normalizedBlockName]
        }
      } else {
        if (blockConfig.category === 'triggers' || sourceBlock.type === 'starter') {
          const dynamicOutputs = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)
          if (dynamicOutputs.length > 0) {
            blockTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
          } else if (sourceBlock.type === 'starter') {
            blockTags = [normalizedBlockName]
          } else if (sourceBlock.type === TRIGGER_TYPES.GENERIC_WEBHOOK) {
            blockTags = [normalizedBlockName]
          } else {
            blockTags = []
          }
        } else if (sourceBlock?.triggerMode && blockConfig.triggers?.enabled) {
          const dynamicOutputs = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks, true)
          if (dynamicOutputs.length > 0) {
            blockTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            const outputPaths = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks, true)
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        } else if (sourceBlock.type === 'approval') {
          const dynamicOutputs = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)

          const isSelfReference = activeSourceBlockId === blockId

          if (dynamicOutputs.length > 0) {
            const allTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference ? allTags.filter((tag) => tag.endsWith('.url')) : allTags
          } else {
            const outputPaths = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)
            const allTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference ? allTags.filter((tag) => tag.endsWith('.url')) : allTags
          }
        } else {
          const operationValue =
            mergedSubBlocks?.operation?.value ?? getSubBlockValue(activeSourceBlockId, 'operation')
          const toolOutputPaths = operationValue
            ? generateToolOutputPaths(blockConfig, operationValue)
            : []

          if (toolOutputPaths.length > 0) {
            blockTags = toolOutputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            const outputPaths = getBlockOutputPaths(
              sourceBlock.type,
              mergedSubBlocks,
              sourceBlock.triggerMode
            )
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        }
      }

      blockTags = ensureRootTag(blockTags, normalizedBlockName)
      const shouldShowRootTag =
        sourceBlock.type === TRIGGER_TYPES.GENERIC_WEBHOOK || sourceBlock.type === 'start_trigger'
      if (!shouldShowRootTag) {
        blockTags = blockTags.filter((tag) => tag !== normalizedBlockName)
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

      return { tags: blockTags, variableInfoMap: {}, blockTagGroups }
    }

    const hasInvalidBlocks = Object.values(blocks).some((block) => !block || !block.type)
    if (hasInvalidBlocks) {
      return { tags: [], variableInfoMap: {}, blockTagGroups: [] }
    }

    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')

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

    const validVariables = workflowVariables.filter(
      (variable: Variable) => variable.name.trim() !== ''
    )

    const variableTags = validVariables.map(
      (variable: Variable) => `${TAG_PREFIXES.VARIABLE}${normalizeVariableName(variable.name)}`
    )

    const variableInfoMap = validVariables.reduce(
      (acc, variable) => {
        const tagName = `${TAG_PREFIXES.VARIABLE}${normalizeVariableName(variable.name)}`
        acc[tagName] = {
          type: variable.type,
          id: variable.id,
        }
        return acc
      },
      {} as Record<string, { type: string; id: string }>
    )

    let loopBlockGroup: BlockTagGroup | null = null

    const isLoopBlock = blocks[blockId]?.type === 'loop'
    const currentLoop = isLoopBlock ? loops[blockId] : null

    const containingLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(blockId))

    let containingLoopBlockId: string | null = null

    if (currentLoop && isLoopBlock) {
      containingLoopBlockId = blockId
      const loopType = currentLoop.loopType || 'for'
      const contextualTags: string[] = ['index', 'currentIteration']
      if (loopType === 'forEach') {
        contextualTags.push('currentItem')
        contextualTags.push('items')
      }

      const loopBlock = blocks[blockId]
      if (loopBlock) {
        const loopBlockName = loopBlock.name || loopBlock.type

        loopBlockGroup = {
          blockName: loopBlockName,
          blockId: blockId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0,
        }
      }
    } else if (containingLoop) {
      const [loopId, loop] = containingLoop
      containingLoopBlockId = loopId
      const loopType = loop.loopType || 'for'
      const contextualTags: string[] = ['index', 'currentIteration']
      if (loopType === 'forEach') {
        contextualTags.push('currentItem')
        contextualTags.push('items')
      }

      const containingLoopBlock = blocks[loopId]
      if (containingLoopBlock) {
        const loopBlockName = containingLoopBlock.name || containingLoopBlock.type

        loopBlockGroup = {
          blockName: loopBlockName,
          blockId: loopId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0,
        }
      }
    }

    let parallelBlockGroup: BlockTagGroup | null = null
    const containingParallel = Object.entries(parallels || {}).find(([_, parallel]) =>
      parallel.nodes.includes(blockId)
    )
    let containingParallelBlockId: string | null = null
    if (containingParallel) {
      const [parallelId, parallel] = containingParallel
      containingParallelBlockId = parallelId
      const parallelType = parallel.parallelType || 'count'
      const contextualTags: string[] = ['index']
      if (parallelType === 'collection') {
        contextualTags.push('currentItem')
        contextualTags.push('items')
      }

      const containingParallelBlock = blocks[parallelId]
      if (containingParallelBlock) {
        const parallelBlockName = containingParallelBlock.name || containingParallelBlock.type

        parallelBlockGroup = {
          blockName: parallelBlockName,
          blockId: parallelId,
          blockType: 'parallel',
          tags: contextualTags,
          distance: 0,
        }
      }
    }

    const blockTagGroups: BlockTagGroup[] = []
    const allBlockTags: string[] = []

    const accessibleBlockIds = combinedAccessiblePrefixes
      ? Array.from(combinedAccessiblePrefixes)
      : []
    for (const accessibleBlockId of accessibleBlockIds) {
      const accessibleBlock = blocks[accessibleBlockId]
      if (!accessibleBlock) continue

      // Skip the current block - blocks cannot reference their own outputs
      // Exception: approval blocks can reference their own outputs
      if (accessibleBlockId === blockId && accessibleBlock.type !== 'approval') continue

      const blockConfig = getBlock(accessibleBlock.type)

      if (!blockConfig) {
        if (accessibleBlock.type === 'loop' || accessibleBlock.type === 'parallel') {
          if (
            accessibleBlockId === containingLoopBlockId ||
            accessibleBlockId === containingParallelBlockId
          ) {
            continue
          }

          const mockConfig = { outputs: { results: 'array' } }
          const blockName = accessibleBlock.name || accessibleBlock.type
          const normalizedBlockName = normalizeBlockName(blockName)

          const outputPaths = generateOutputPaths(mockConfig.outputs)
          let blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          blockTags = ensureRootTag(blockTags, normalizedBlockName)

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
      const normalizedBlockName = normalizeBlockName(blockName)

      const mergedSubBlocks = getMergedSubBlocks(accessibleBlockId)
      const responseFormatValue = mergedSubBlocks?.responseFormat?.value
      const responseFormat = parseResponseFormatSafely(responseFormatValue, accessibleBlockId)

      let blockTags: string[]

      if (blockConfig.category === 'triggers' || accessibleBlock.type === 'starter') {
        const dynamicOutputs = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks)

        if (dynamicOutputs.length > 0) {
          blockTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
        } else if (accessibleBlock.type === 'starter') {
          const startWorkflowValue = mergedSubBlocks?.startWorkflow?.value
          if (startWorkflowValue === 'chat') {
            blockTags = [
              `${normalizedBlockName}.input`,
              `${normalizedBlockName}.conversationId`,
              `${normalizedBlockName}.files`,
            ]
          } else {
            blockTags = [normalizedBlockName]
          }
        } else if (accessibleBlock.type === TRIGGER_TYPES.GENERIC_WEBHOOK) {
          blockTags = [normalizedBlockName]
        } else {
          blockTags = []
        }
      } else if (accessibleBlock.type === 'evaluator') {
        const metricsValue = getSubBlockValue(accessibleBlockId, 'metrics')

        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const validMetrics = metricsValue.filter((metric: { name?: string }) => metric?.name)
          blockTags = validMetrics.map(
            (metric: { name: string }) => `${normalizedBlockName}.${metric.name.toLowerCase()}`
          )
        } else {
          const outputPaths = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks)
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (accessibleBlock.type === 'variables') {
        const variablesValue = getSubBlockValue(accessibleBlockId, 'variables')

        if (variablesValue && Array.isArray(variablesValue) && variablesValue.length > 0) {
          const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
            assignment?.variableName?.trim()
          )
          blockTags = validAssignments.map(
            (assignment: { variableName: string }) =>
              `${normalizedBlockName}.${assignment.variableName.trim()}`
          )
        } else {
          blockTags = [normalizedBlockName]
        }
      } else if (responseFormat) {
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)
        } else {
          const outputPaths = getBlockOutputPaths(
            accessibleBlock.type,
            mergedSubBlocks,
            accessibleBlock.triggerMode
          )
          blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
        }
      } else if (!blockConfig.outputs || Object.keys(blockConfig.outputs).length === 0) {
        blockTags = [normalizedBlockName]
      } else {
        const blockState = blocks[accessibleBlockId]
        if (blockState?.triggerMode && blockConfig.triggers?.enabled) {
          const dynamicOutputs = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks, true)
          if (dynamicOutputs.length > 0) {
            blockTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            const outputPaths = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks, true)
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        } else if (accessibleBlock.type === 'approval') {
          const dynamicOutputs = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks)

          const isSelfReference = accessibleBlockId === blockId

          if (dynamicOutputs.length > 0) {
            const allTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference ? allTags.filter((tag) => tag.endsWith('.url')) : allTags
          } else {
            const outputPaths = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks)
            const allTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference ? allTags.filter((tag) => tag.endsWith('.url')) : allTags
          }
        } else {
          const operationValue =
            mergedSubBlocks?.operation?.value ?? getSubBlockValue(accessibleBlockId, 'operation')
          const toolOutputPaths = operationValue
            ? generateToolOutputPaths(blockConfig, operationValue)
            : []

          if (toolOutputPaths.length > 0) {
            blockTags = toolOutputPaths.map((path) => `${normalizedBlockName}.${path}`)
          } else {
            const outputPaths = getBlockOutputPaths(
              accessibleBlock.type,
              mergedSubBlocks,
              accessibleBlock.triggerMode
            )
            blockTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
          }
        }
      }

      blockTags = ensureRootTag(blockTags, normalizedBlockName)
      const shouldShowRootTag =
        accessibleBlock.type === TRIGGER_TYPES.GENERIC_WEBHOOK ||
        accessibleBlock.type === 'start_trigger'
      if (!shouldShowRootTag) {
        blockTags = blockTags.filter((tag) => tag !== normalizedBlockName)
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

    const finalBlockTagGroups: BlockTagGroup[] = []
    if (loopBlockGroup) {
      finalBlockTagGroups.push(loopBlockGroup)
    }
    if (parallelBlockGroup) {
      finalBlockTagGroups.push(parallelBlockGroup)
    }

    blockTagGroups.sort((a, b) => a.distance - b.distance)
    finalBlockTagGroups.push(...blockTagGroups)

    const contextualTags: string[] = []
    if (loopBlockGroup) {
      contextualTags.push(...loopBlockGroup.tags)
    }
    if (parallelBlockGroup) {
      contextualTags.push(...parallelBlockGroup.tags)
    }

    return {
      tags: [...allBlockTags, ...variableTags, ...contextualTags],
      variableInfoMap,
      blockTagGroups: finalBlockTagGroups,
    }
  }, [
    activeSourceBlockId,
    combinedAccessiblePrefixes,
    blockId,
    blocks,
    edges,
    getMergedSubBlocks,
    loops,
    parallels,
    workflowVariables,
    workflowId,
  ])

  const filteredTags = useMemo(() => {
    if (!searchTerm) return tags
    return tags.filter((tag) => tag.toLowerCase().includes(searchTerm))
  }, [tags, searchTerm])

  const { variableTags, filteredBlockTagGroups } = useMemo(() => {
    const varTags: string[] = []

    filteredTags.forEach((tag: string) => {
      if (tag.startsWith(TAG_PREFIXES.VARIABLE)) {
        varTags.push(tag)
      }
    })

    const filteredGroups = blockTagGroups
      .map((group: BlockTagGroup) => ({
        ...group,
        tags: group.tags.filter(
          (tag: string) => !searchTerm || tag.toLowerCase().includes(searchTerm)
        ),
      }))
      .filter((group: BlockTagGroup) => group.tags.length > 0)

    return {
      variableTags: varTags,
      filteredBlockTagGroups: filteredGroups,
    }
  }, [filteredTags, blockTagGroups, searchTerm])

  const nestedBlockTagGroups: NestedBlockTagGroup[] = useMemo(() => {
    return filteredBlockTagGroups.map((group: BlockTagGroup) => {
      const nestedTags: NestedTag[] = []
      const groupedTags: Record<
        string,
        Array<{ key: string; display: string; fullTag: string }>
      > = {}
      const directTags: Array<{ key: string; display: string; fullTag: string }> = []

      group.tags.forEach((tag: string) => {
        const tagParts = tag.split('.')
        if (tagParts.length >= 3) {
          const parent = tagParts[1]
          const child = tagParts.slice(2).join('.')

          if (!groupedTags[parent]) {
            groupedTags[parent] = []
          }
          groupedTags[parent].push({
            key: `${parent}.${child}`,
            display: child,
            fullTag: tag,
          })
        } else {
          const path = tagParts.slice(1).join('.')
          if (
            (group.blockType === 'loop' || group.blockType === 'parallel') &&
            tagParts.length === 1
          ) {
            directTags.push({
              key: tag,
              display: tag,
              fullTag: tag,
            })
          } else {
            directTags.push({
              key: path || group.blockName,
              display: path || group.blockName,
              fullTag: tag,
            })
          }
        }
      })

      Object.entries(groupedTags).forEach(([parent, children]) => {
        const firstChildTag = children[0]?.fullTag
        if (firstChildTag) {
          const tagParts = firstChildTag.split('.')
          const parentTag = `${tagParts[0]}.${parent}`
          nestedTags.push({
            key: parent,
            display: parent,
            parentTag: parentTag,
            children: children,
          })
        } else {
          nestedTags.push({
            key: parent,
            display: parent,
            children: children,
          })
        }
      })

      directTags.forEach((directTag) => {
        nestedTags.push(directTag)
      })

      return {
        ...group,
        nestedTags,
      }
    })
  }, [filteredBlockTagGroups])

  const flatTagList = useMemo(() => {
    const list: Array<{ tag: string; group?: BlockTagGroup }> = []

    variableTags.forEach((tag) => {
      list.push({ tag })
    })

    nestedBlockTagGroups.forEach((group) => {
      group.nestedTags.forEach((nestedTag) => {
        if (nestedTag.parentTag) {
          list.push({ tag: nestedTag.parentTag, group })
        }
        if (nestedTag.fullTag) {
          list.push({ tag: nestedTag.fullTag, group })
        }
        if (nestedTag.children) {
          nestedTag.children.forEach((child) => {
            list.push({ tag: child.fullTag, group })
          })
        }
      })
    })

    return list
  }, [variableTags, nestedBlockTagGroups])

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!visible || selectedIndex < 0) return

    const element = itemRefs.current.get(selectedIndex)
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedIndex, visible])

  const handleTagSelect = useCallback(
    (tag: string, blockGroup?: BlockTagGroup) => {
      let liveCursor = cursorPosition
      let liveValue = inputValue

      if (typeof window !== 'undefined' && document?.activeElement) {
        const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        if (activeEl && typeof activeEl.selectionStart === 'number') {
          liveCursor = activeEl.selectionStart ?? cursorPosition
          if ('value' in activeEl && typeof activeEl.value === 'string') {
            liveValue = activeEl.value
          }
        }
      }

      const textBeforeCursor = liveValue.slice(0, liveCursor)
      const textAfterCursor = liveValue.slice(liveCursor)

      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
      if (lastOpenBracket === -1) return

      let processedTag = tag

      // Check if this is a file property and add [0] automatically
      // Only include user-accessible fields (matches UserFile interface)
      const fileProperties = ['id', 'name', 'url', 'size', 'type']
      const parts = tag.split('.')
      if (parts.length >= 2 && fileProperties.includes(parts[parts.length - 1])) {
        const fieldName = parts[parts.length - 2]

        if (blockGroup) {
          const block = useWorkflowStore.getState().blocks[blockGroup.blockId]
          const blockConfig = block ? (getBlock(block.type) ?? null) : null
          const mergedSubBlocks = getMergedSubBlocks(blockGroup.blockId)

          const fieldType = getOutputTypeForPath(
            block,
            blockConfig,
            blockGroup.blockId,
            fieldName,
            mergedSubBlocks
          )

          if (fieldType === 'files') {
            const blockAndField = parts.slice(0, -1).join('.')
            const property = parts[parts.length - 1]
            processedTag = `${blockAndField}[0].${property}`
          }
        }
      }

      if (tag.startsWith(TAG_PREFIXES.VARIABLE)) {
        const variableName = tag.substring(TAG_PREFIXES.VARIABLE.length)
        const variableObj = workflowVariables.find(
          (v: Variable) => v.name.replace(/\s+/g, '') === variableName
        )

        if (variableObj) {
          processedTag = tag
        }
      } else if (
        blockGroup &&
        (blockGroup.blockType === 'loop' || blockGroup.blockType === 'parallel')
      ) {
        if (
          !tag.includes('.') &&
          ['index', 'currentItem', 'items', 'currentIteration'].includes(tag)
        ) {
          processedTag = `${blockGroup.blockType}.${tag}`
        } else {
          processedTag = tag
        }
      }

      const nextCloseBracket = textAfterCursor.indexOf('>')
      let remainingTextAfterCursor = textAfterCursor

      if (nextCloseBracket !== -1) {
        const textBetween = textAfterCursor.slice(0, nextCloseBracket)
        if (/^[a-zA-Z0-9._]*$/.test(textBetween)) {
          remainingTextAfterCursor = textAfterCursor.slice(nextCloseBracket + 1)
        }
      }

      const newValue = `${textBeforeCursor.slice(0, lastOpenBracket)}<${processedTag}>${remainingTextAfterCursor}`

      onSelect(newValue)
      onClose?.()
    },
    [inputValue, cursorPosition, workflowVariables, onSelect, onClose, getMergedSubBlocks]
  )

  useEffect(() => setSelectedIndex(0), [searchTerm])

  useEffect(() => {
    if (selectedIndex >= flatTagList.length) {
      setSelectedIndex(Math.max(0, flatTagList.length - 1))
    }
  }, [flatTagList.length, selectedIndex])

  useEffect(() => {
    if (visible) {
      const handleKeyboardEvent = (e: KeyboardEvent) => {
        switch (e.key) {
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
  }, [visible, onClose])

  if (!visible || tags.length === 0 || flatTagList.length === 0) return null

  // Calculate caret position for proper anchoring
  const inputElement = inputRef?.current
  let caretViewport = { left: 0, top: 0 }
  let side: 'top' | 'bottom' = 'bottom'

  if (inputElement) {
    caretViewport = getCaretViewportPosition(inputElement, cursorPosition, inputValue)

    const margin = 8
    const spaceAbove = caretViewport.top - margin
    const spaceBelow = window.innerHeight - caretViewport.top - margin
    side = spaceBelow >= spaceAbove ? 'bottom' : 'top'
  }

  return (
    <Popover open={visible} onOpenChange={(open) => !open && onClose?.()}>
      <PopoverAnchor asChild>
        <div
          className={cn('pointer-events-none', className)}
          style={{
            ...style,
            position: inputElement ? 'fixed' : 'absolute',
            top: inputElement ? `${caretViewport.top}px` : style?.top,
            left: inputElement ? `${caretViewport.left}px` : style?.left,
            width: '1px',
            height: '1px',
          }}
        />
      </PopoverAnchor>
      <KeyboardNavigationHandler
        visible={visible}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
        flatTagList={flatTagList}
        nestedBlockTagGroups={nestedBlockTagGroups}
        handleTagSelect={handleTagSelect}
      />
      <PopoverContent
        maxHeight={240}
        className='min-w-[280px]'
        side={side}
        align='start'
        collisionPadding={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <TagDropdownBackButton
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          flatTagList={flatTagList}
          nestedBlockTagGroups={nestedBlockTagGroups}
          itemRefs={itemRefs}
        />
        <PopoverScrollArea>
          {flatTagList.length === 0 ? (
            <div className='px-[6px] py-[8px] text-[12px] text-[var(--white)]/60'>
              No matching tags found
            </div>
          ) : (
            <>
              {variableTags.length > 0 && (
                <>
                  <PopoverSection>Variables</PopoverSection>
                  {variableTags.map((tag: string) => {
                    const variableInfo = variableInfoMap?.[tag] || null
                    const globalIndex = flatTagList.findIndex((item) => item.tag === tag)

                    return (
                      <PopoverItem
                        key={tag}
                        rootOnly
                        active={globalIndex === selectedIndex && globalIndex >= 0}
                        onMouseEnter={() => {
                          if (globalIndex >= 0) setSelectedIndex(globalIndex)
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTagSelect(tag)
                        }}
                        ref={(el) => {
                          if (el && globalIndex >= 0) {
                            itemRefs.current.set(globalIndex, el)
                          }
                        }}
                      >
                        <TagIcon icon='V' color={BLOCK_COLORS.VARIABLE} />
                        <span className='flex-1 truncate'>
                          {tag.startsWith(TAG_PREFIXES.VARIABLE)
                            ? tag.substring(TAG_PREFIXES.VARIABLE.length)
                            : tag}
                        </span>
                        {variableInfo && (
                          <span className='ml-auto text-[10px] text-[var(--white)]/60'>
                            {variableInfo.type}
                          </span>
                        )}
                      </PopoverItem>
                    )
                  })}
                </>
              )}

              {nestedBlockTagGroups.map((group: NestedBlockTagGroup) => {
                const blockConfig = getBlock(group.blockType)
                let blockColor = blockConfig?.bgColor || BLOCK_COLORS.DEFAULT

                if (group.blockType === 'loop') {
                  blockColor = BLOCK_COLORS.LOOP
                } else if (group.blockType === 'parallel') {
                  blockColor = BLOCK_COLORS.PARALLEL
                }

                const tagIcon = group.blockName.charAt(0).toUpperCase()

                return (
                  <div key={group.blockId}>
                    <PopoverSection rootOnly>{group.blockName}</PopoverSection>
                    {group.nestedTags.map((nestedTag) => {
                      const hasChildren = nestedTag.children && nestedTag.children.length > 0

                      if (hasChildren) {
                        const folderId = `${group.blockId}-${nestedTag.key}`

                        const parentGlobalIndex = nestedTag.parentTag
                          ? flatTagList.findIndex((item) => item.tag === nestedTag.parentTag)
                          : -1

                        return (
                          <PopoverFolder
                            key={folderId}
                            id={folderId}
                            title={nestedTag.display}
                            icon={<TagIcon icon={tagIcon} color={blockColor} />}
                            active={parentGlobalIndex === selectedIndex && parentGlobalIndex >= 0}
                            onSelect={() => {
                              if (nestedTag.parentTag) {
                                handleTagSelect(nestedTag.parentTag, group)
                              }
                            }}
                            onMouseEnter={() => {
                              if (parentGlobalIndex >= 0) {
                                setSelectedIndex(parentGlobalIndex)
                              }
                            }}
                            ref={(el) => {
                              if (el && parentGlobalIndex >= 0) {
                                itemRefs.current.set(parentGlobalIndex, el)
                              }
                            }}
                          >
                            {nestedTag.children!.map((child) => {
                              const childGlobalIndex = flatTagList.findIndex(
                                (item) => item.tag === child.fullTag
                              )

                              const tagParts = child.fullTag.split('.')
                              const outputPath = tagParts.slice(1).join('.')

                              let childType = ''
                              const block = Object.values(blocks).find(
                                (b) => b.id === group.blockId
                              )
                              if (block) {
                                const blockConfig = getBlock(block.type)
                                const mergedSubBlocks = getMergedSubBlocks(group.blockId)

                                childType = getOutputTypeForPath(
                                  block,
                                  blockConfig || null,
                                  group.blockId,
                                  outputPath,
                                  mergedSubBlocks
                                )
                              }

                              return (
                                <PopoverItem
                                  key={child.key}
                                  active={
                                    childGlobalIndex === selectedIndex && childGlobalIndex >= 0
                                  }
                                  onMouseEnter={() => {
                                    if (childGlobalIndex >= 0) setSelectedIndex(childGlobalIndex)
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleTagSelect(child.fullTag, group)
                                  }}
                                  ref={(el) => {
                                    if (el && childGlobalIndex >= 0) {
                                      itemRefs.current.set(childGlobalIndex, el)
                                    }
                                  }}
                                >
                                  <TagIcon icon={tagIcon} color={blockColor} />
                                  <span className='flex-1 truncate'>{child.display}</span>
                                  {childType && childType !== 'any' && (
                                    <span className='ml-auto text-[10px] text-[var(--white)]/60'>
                                      {childType}
                                    </span>
                                  )}
                                </PopoverItem>
                              )
                            })}
                          </PopoverFolder>
                        )
                      }

                      // Direct tag (no children)
                      const globalIndex = nestedTag.fullTag
                        ? flatTagList.findIndex((item) => item.tag === nestedTag.fullTag)
                        : -1

                      let tagDescription = ''
                      let displayIcon = tagIcon

                      if (
                        (group.blockType === 'loop' || group.blockType === 'parallel') &&
                        !nestedTag.key.includes('.')
                      ) {
                        if (nestedTag.key === 'index') {
                          displayIcon = '#'
                          tagDescription = 'number'
                        } else if (nestedTag.key === 'currentItem') {
                          displayIcon = 'i'
                          tagDescription = 'any'
                        } else if (nestedTag.key === 'items') {
                          displayIcon = 'I'
                          tagDescription = 'array'
                        } else if (nestedTag.key === 'currentIteration') {
                          displayIcon = '#'
                          tagDescription = 'number'
                        }
                      } else if (nestedTag.fullTag) {
                        const tagParts = nestedTag.fullTag.split('.')
                        const outputPath = tagParts.slice(1).join('.')

                        const block = Object.values(blocks).find((b) => b.id === group.blockId)
                        if (block) {
                          const blockConfig = getBlock(block.type)
                          const mergedSubBlocks = getMergedSubBlocks(group.blockId)

                          tagDescription = getOutputTypeForPath(
                            block,
                            blockConfig || null,
                            group.blockId,
                            outputPath,
                            mergedSubBlocks
                          )
                        }
                      }

                      return (
                        <PopoverItem
                          key={`${group.blockId}-${nestedTag.key}`}
                          rootOnly
                          active={globalIndex === selectedIndex && globalIndex >= 0}
                          onMouseEnter={() => {
                            if (globalIndex >= 0) setSelectedIndex(globalIndex)
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (nestedTag.fullTag) {
                              handleTagSelect(nestedTag.fullTag, group)
                            }
                          }}
                          ref={(el) => {
                            if (el && globalIndex >= 0) {
                              itemRefs.current.set(globalIndex, el)
                            }
                          }}
                        >
                          <TagIcon icon={displayIcon} color={blockColor} />
                          <span className='flex-1 truncate'>{nestedTag.display}</span>
                          {tagDescription && tagDescription !== 'any' && (
                            <span className='ml-auto text-[10px] text-[var(--white)]/60'>
                              {tagDescription}
                            </span>
                          )}
                        </PopoverItem>
                      )
                    })}
                  </div>
                )
              })}
            </>
          )}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
