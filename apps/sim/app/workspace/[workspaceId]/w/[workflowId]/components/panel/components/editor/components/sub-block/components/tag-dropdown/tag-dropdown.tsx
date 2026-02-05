import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverFolder,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  usePopoverContext,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import {
  getBlockOutputPaths,
  getBlockOutputType,
  getOutputPathsFromSchema,
  getToolOutputPaths,
  getToolOutputType,
} from '@/lib/workflows/blocks/block-outputs'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers/triggers'
import { KeyboardNavigationHandler } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/components/keyboard-navigation-handler'
import type {
  BlockTagGroup,
  NestedBlockTagGroup,
  NestedTag,
  NestedTagChild,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/types'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { normalizeName } from '@/executor/constants'
import type { Variable } from '@/stores/panel'
import { useVariablesStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Context for sharing nested navigation state between components.
 * This enables unlimited nesting depth with a single back button.
 */
interface NestedNavigationContextValue {
  /** Stack of nested tags representing current navigation depth */
  nestedPath: NestedTag[]
  /** Navigate into a nested folder */
  navigateIn: (tag: NestedTag, group: NestedBlockTagGroup) => void
  /** Navigate back one level, returns true if navigation happened, false if at root */
  navigateBack: () => boolean
  /** Register the base folder when it opens */
  registerFolder: (
    folderId: string,
    folderTitle: string,
    baseTag: NestedTag,
    group: NestedBlockTagGroup
  ) => void
}

const NestedNavigationContext = React.createContext<NestedNavigationContextValue | null>(null)

/** Hook to access nested navigation state from child components */
export const useNestedNavigation = () => React.useContext(NestedNavigationContext)

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

interface TagComputationResult {
  tags: string[]
  variableInfoMap: Record<string, { type: string; id: string }>
  blockTagGroups: BlockTagGroup[]
}

/**
 * Checks if the tag trigger (`<`) should show the tag dropdown.
 *
 * @remarks
 * The dropdown appears when there's an unclosed `<` bracket before the cursor.
 * A closing `>` bracket after the last `<` will prevent the dropdown from showing.
 *
 * @param text - The full text content of the input field
 * @param cursorPosition - Current cursor position in the text
 * @returns Object with `show` property indicating whether to display the dropdown
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

/**
 * Extracts the search term for tag filtering from the current input.
 *
 * @remarks
 * Returns the text between the last unclosed `<` and the cursor position,
 * converted to lowercase for case-insensitive matching.
 *
 * @param text - The full text content of the input field
 * @param cursorPosition - Current cursor position in the text
 * @returns The search term for filtering tags, or empty string if not in tag context
 */
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

/**
 * Color constants for block type icons in the tag dropdown.
 */
const BLOCK_COLORS = {
  VARIABLE: '#2F8BFF',
  DEFAULT: '#2F55FF',
  LOOP: '#2FB3FF',
  PARALLEL: '#FEE12B',
} as const

/**
 * Prefix constants for special tag types.
 */
const TAG_PREFIXES = {
  VARIABLE: 'variable.',
} as const

/**
 * Ensures the root tag is present in the tags array
 */
const ensureRootTag = (tags: string[], rootTag: string): string[] => {
  if (!rootTag) return tags
  if (tags.includes(rootTag)) return tags
  return [rootTag, ...tags]
}

/**
 * Gets a subblock value from the store.
 *
 * @param blockId - The block identifier
 * @param property - The property name to retrieve
 * @returns The value from the subblock store
 */
const getSubBlockValue = (blockId: string, property: string): any => {
  return useSubBlockStore.getState().getValue(blockId, property)
}

/**
 * Gets the output type for a specific path in a block's outputs.
 *
 * @remarks
 * Handles special cases for trigger blocks, starter blocks with chat mode,
 * and tool-based operations.
 *
 * @param block - The block state
 * @param blockConfig - The block configuration, or null
 * @param blockId - The block identifier
 * @param outputPath - The dot-separated path to the output field
 * @param mergedSubBlocksOverride - Optional override for subblock values
 * @returns The type of the output field (e.g., 'string', 'array', 'any')
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
        files: 'file[]',
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
  } else if (blockConfig?.tools?.config?.tool) {
    const blockState = useWorkflowStore.getState().blocks[blockId]
    const subBlocks = mergedSubBlocksOverride ?? (blockState?.subBlocks || {})
    return getToolOutputType(blockConfig, subBlocks, outputPath)
  }

  const subBlocks =
    mergedSubBlocksOverride ?? useWorkflowStore.getState().blocks[blockId]?.subBlocks
  const triggerMode = block?.triggerMode && blockConfig?.triggers?.enabled
  return getBlockOutputType(block?.type ?? '', outputPath, subBlocks, triggerMode)
}

/**
 * Calculates the viewport position of the caret in a textarea/input.
 *
 * @remarks
 * Creates a hidden mirror div with identical styling to measure the
 * precise position of the caret for popover anchoring.
 *
 * @param element - The textarea or input element
 * @param caretPosition - The character position of the caret
 * @param text - The text content of the element
 * @returns Object with `left` and `top` viewport coordinates
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
 * Renders a tag icon with background color.
 *
 * @remarks
 * Supports either a React icon component or a single letter string
 * for flexible icon display in the tag dropdown.
 *
 * @param icon - Either a letter string or a Lucide icon component
 * @param color - Background color for the icon container
 * @returns A styled icon element
 */
/**
 * Tree node for building nested tag hierarchy
 */
interface TagTreeNode {
  key: string
  fullTag?: string
  children: Map<string, TagTreeNode>
}

/**
 * Builds a recursive tree structure from flat tag paths.
 * Converts tags like `blockname.form.info.title` into a nested tree.
 *
 * @param tags - Array of dot-separated tag paths
 * @param blockName - The normalized block name (first segment of tags)
 * @returns Array of NestedTag with recursive nestedChildren
 */
const buildNestedTagTree = (tags: string[], blockName: string): NestedTag[] => {
  const root: TagTreeNode = { key: 'root', children: new Map() }

  for (const tag of tags) {
    const parts = tag.split('.')
    if (parts.length < 2) continue

    const pathParts = parts.slice(1)
    let current = root

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (!current.children.has(part)) {
        current.children.set(part, {
          key: part,
          children: new Map(),
        })
      }
      const node = current.children.get(part)!

      if (i === pathParts.length - 1) {
        node.fullTag = tag
      }
      current = node
    }
  }

  const convertToNestedTags = (
    node: TagTreeNode,
    parentPath: string,
    blockPrefix: string
  ): NestedTag[] => {
    const result: NestedTag[] = []

    for (const [key, child] of node.children) {
      const currentPath = parentPath ? `${parentPath}.${key}` : key
      const parentTag = `${blockPrefix}.${currentPath}`

      if (child.children.size === 0) {
        result.push({
          key: currentPath,
          display: key,
          fullTag: child.fullTag || parentTag,
        })
      } else {
        const nestedChildren = convertToNestedTags(child, currentPath, blockPrefix)

        const leafChildren: NestedTagChild[] = []
        const folders: NestedTag[] = []

        for (const nestedChild of nestedChildren) {
          if (nestedChild.nestedChildren || nestedChild.children) {
            folders.push(nestedChild)
          } else {
            leafChildren.push({
              key: nestedChild.key,
              display: nestedChild.display,
              fullTag: nestedChild.fullTag!,
            })
          }
        }

        result.push({
          key: currentPath,
          display: key,
          parentTag,
          children: leafChildren.length > 0 ? leafChildren : undefined,
          nestedChildren: folders.length > 0 ? folders : undefined,
        })
      }
    }

    return result
  }

  return convertToNestedTags(root, '', blockName)
}

const TagIcon: React.FC<{
  icon: string | React.ComponentType<{ className?: string }>
  color: string
}> = ({ icon, color }) => (
  <div
    className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded'
    style={{ background: color }}
  >
    {typeof icon === 'string' ? (
      <span className='!text-white font-bold text-[10px]'>{icon}</span>
    ) : (
      (() => {
        const IconComponent = icon
        return <IconComponent className='!text-white size-[9px]' />
      })()
    )}
  </div>
)

/**
 * Props for the recursive NestedTagRenderer component
 */
interface NestedTagRendererProps {
  nestedTag: NestedTag
  group: NestedBlockTagGroup
  flatTagList: Array<{ tag: string; group?: BlockTagGroup }>
  /** Map from tag string to index for O(1) lookups */
  flatTagIndexMap: Map<string, number>
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  handleTagSelect: (tag: string, blockGroup?: BlockTagGroup) => void
  itemRefs: React.RefObject<Map<string, HTMLElement>>
  blocks: Record<string, BlockState>
  getMergedSubBlocks: (blockId: string) => Record<string, any>
}

/**
 * Props for FolderContents with nested navigation state
 */
interface FolderContentsProps extends NestedTagRendererProps {
  /** Current nested path stack for navigation within this folder */
  nestedPath: NestedTag[]
  /** Callback to navigate into a subfolder */
  onNavigateIn: (nestedTag: NestedTag) => void
}

/**
 * Renders the contents of a folder (leaf children + nested subfolder triggers).
 * The parent tag is rendered as the first item in the list for selection.
 */
const FolderContentsInner: React.FC<FolderContentsProps> = ({
  group,
  flatTagList,
  flatTagIndexMap,
  selectedIndex,
  setSelectedIndex,
  handleTagSelect,
  itemRefs,
  blocks,
  getMergedSubBlocks,
  nestedPath,
  nestedTag,
  onNavigateIn,
}) => {
  const { isKeyboardNav, setKeyboardNav } = usePopoverContext()
  const currentNestedTag = nestedPath.length > 0 ? nestedPath[nestedPath.length - 1] : nestedTag

  const parentTagIndex = currentNestedTag.parentTag
    ? (flatTagIndexMap.get(currentNestedTag.parentTag) ?? -1)
    : -1

  return (
    <>
      {/* Render parent tag as the first selectable item */}
      {currentNestedTag.parentTag && (
        <PopoverItem
          active={parentTagIndex === selectedIndex && parentTagIndex >= 0}
          onMouseEnter={() => {
            if (isKeyboardNav) return
            setKeyboardNav(false)
            if (parentTagIndex >= 0) setSelectedIndex(parentTagIndex)
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleTagSelect(currentNestedTag.parentTag!, group)
          }}
          ref={(el) => {
            if (el && currentNestedTag.parentTag) {
              itemRefs.current?.set(currentNestedTag.parentTag, el)
            }
          }}
        >
          <span className='flex-1 truncate font-medium'>{currentNestedTag.display}</span>
        </PopoverItem>
      )}

      {/* Render leaf children as PopoverItems */}
      {currentNestedTag.children?.map((child) => {
        const childGlobalIndex = flatTagIndexMap.get(child.fullTag) ?? -1

        const tagParts = child.fullTag.split('.')
        const outputPath = tagParts.slice(1).join('.')

        let childType = ''
        const block = Object.values(blocks).find((b) => b.id === group.blockId)
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
            active={childGlobalIndex === selectedIndex && childGlobalIndex >= 0}
            onMouseEnter={() => {
              if (isKeyboardNav) return
              setKeyboardNav(false)
              if (childGlobalIndex >= 0) setSelectedIndex(childGlobalIndex)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleTagSelect(child.fullTag, group)
            }}
            ref={(el) => {
              if (el) {
                itemRefs.current?.set(child.fullTag, el)
              }
            }}
          >
            <span className='flex-1 truncate'>{child.display}</span>
            {childType && childType !== 'any' && (
              <span className='ml-auto text-[10px] text-[var(--text-muted-inverse)]'>
                {childType}
              </span>
            )}
          </PopoverItem>
        )
      })}

      {/* Render nested children as clickable folder items */}
      {currentNestedTag.nestedChildren?.map((nestedChild) => {
        const parentGlobalIndex = nestedChild.parentTag
          ? (flatTagIndexMap.get(nestedChild.parentTag) ?? -1)
          : -1

        return (
          <PopoverItem
            key={`${group.blockId}-${nestedChild.key}`}
            active={parentGlobalIndex === selectedIndex && parentGlobalIndex >= 0}
            onMouseEnter={() => {
              if (isKeyboardNav) return
              setKeyboardNav(false)
              if (parentGlobalIndex >= 0) setSelectedIndex(parentGlobalIndex)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onNavigateIn(nestedChild)
            }}
            ref={(el) => {
              if (el && nestedChild.parentTag) {
                itemRefs.current?.set(nestedChild.parentTag, el)
              }
            }}
          >
            <span className='flex-1 truncate'>{nestedChild.display}</span>
            <span className='ml-auto text-[10px] text-[var(--text-muted-inverse)]'>{'>'}</span>
          </PopoverItem>
        )
      })}
    </>
  )
}

/**
 * Wrapper component that uses shared nested navigation state from context.
 * Handles registration of the base folder and navigation callbacks.
 */
const FolderContents: React.FC<Omit<NestedTagRendererProps, never>> = (props) => {
  const nestedNav = useNestedNavigation()
  const { currentFolder } = usePopoverContext()

  const nestedPath = nestedNav?.nestedPath ?? []

  useEffect(() => {
    if (nestedNav && currentFolder) {
      const folderId = `${props.group.blockId}-${props.nestedTag.key}`
      if (currentFolder === folderId) {
        nestedNav.registerFolder(folderId, props.nestedTag.display, props.nestedTag, props.group)
      }
    }
  }, [currentFolder, nestedNav, props.group, props.nestedTag])

  const handleNavigateIn = useCallback(
    (nestedTag: NestedTag) => {
      nestedNav?.navigateIn(nestedTag, props.group)
    },
    [nestedNav, props.group]
  )

  return <FolderContentsInner {...props} nestedPath={nestedPath} onNavigateIn={handleNavigateIn} />
}

/**
 * Recursively renders nested tags with PopoverFolder components.
 * Handles arbitrary depth of nesting for deeply nested object structures.
 */
const NestedTagRenderer: React.FC<NestedTagRendererProps> = ({
  nestedTag,
  group,
  flatTagList,
  flatTagIndexMap,
  selectedIndex,
  setSelectedIndex,
  handleTagSelect,
  itemRefs,
  blocks,
  getMergedSubBlocks,
}) => {
  const { isKeyboardNav, setKeyboardNav } = usePopoverContext()
  const hasChildren = nestedTag.children && nestedTag.children.length > 0
  const hasNestedChildren = nestedTag.nestedChildren && nestedTag.nestedChildren.length > 0

  if (hasChildren || hasNestedChildren) {
    const folderId = `${group.blockId}-${nestedTag.key}`

    const parentGlobalIndex = nestedTag.parentTag
      ? (flatTagIndexMap.get(nestedTag.parentTag) ?? -1)
      : -1

    return (
      <PopoverFolder
        key={folderId}
        id={folderId}
        title={nestedTag.display}
        active={parentGlobalIndex === selectedIndex && parentGlobalIndex >= 0}
        onSelect={() => {
          if (nestedTag.parentTag) {
            handleTagSelect(nestedTag.parentTag, group)
          }
        }}
        onMouseEnter={() => {
          if (isKeyboardNav) return
          setKeyboardNav(false)
          if (parentGlobalIndex >= 0) {
            setSelectedIndex(parentGlobalIndex)
          }
        }}
        ref={(el) => {
          if (el && nestedTag.parentTag) {
            itemRefs.current?.set(nestedTag.parentTag, el)
          }
        }}
      >
        <FolderContents
          nestedTag={nestedTag}
          group={group}
          flatTagList={flatTagList}
          flatTagIndexMap={flatTagIndexMap}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          handleTagSelect={handleTagSelect}
          itemRefs={itemRefs}
          blocks={blocks}
          getMergedSubBlocks={getMergedSubBlocks}
        />
      </PopoverFolder>
    )
  }

  const globalIndex = nestedTag.fullTag ? (flatTagIndexMap.get(nestedTag.fullTag) ?? -1) : -1

  let tagDescription = ''

  // Handle loop/parallel contextual tags with special types
  if (
    (group.blockType === 'loop' || group.blockType === 'parallel') &&
    !nestedTag.key.includes('.')
  ) {
    if (nestedTag.key === 'index') {
      tagDescription = 'number'
    } else if (nestedTag.key === 'currentItem') {
      tagDescription = 'any'
    } else if (nestedTag.key === 'items') {
      tagDescription = 'array'
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
        if (isKeyboardNav) return
        setKeyboardNav(false)
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
        if (el && nestedTag.fullTag) {
          itemRefs.current?.set(nestedTag.fullTag, el)
        }
      }}
    >
      <span className='flex-1 truncate'>{nestedTag.display}</span>
      {tagDescription && tagDescription !== 'any' && (
        <span className='ml-auto text-[10px] text-[var(--text-muted-inverse)]'>
          {tagDescription}
        </span>
      )}
    </PopoverItem>
  )
}

/**
 * Hook to get mouse enter handler that respects keyboard navigation state.
 * Returns a handler that only updates selection if not in keyboard mode.
 */
const useKeyboardAwareMouseEnter = (
  setSelectedIndex: (index: number) => void
): ((index: number) => void) => {
  const { isKeyboardNav, setKeyboardNav } = usePopoverContext()

  return useCallback(
    (index: number) => {
      if (isKeyboardNav) return
      setKeyboardNav(false)
      if (index >= 0) setSelectedIndex(index)
    },
    [isKeyboardNav, setKeyboardNav, setSelectedIndex]
  )
}

/**
 * Wrapper for variable tag items that has access to popover context
 */
const VariableTagItem: React.FC<{
  tag: string
  globalIndex: number
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  handleTagSelect: (tag: string) => void
  itemRefs: React.RefObject<Map<string, HTMLElement>>
  variableInfo: { type: string; id: string } | null
}> = ({
  tag,
  globalIndex,
  selectedIndex,
  setSelectedIndex,
  handleTagSelect,
  itemRefs,
  variableInfo,
}) => {
  const handleMouseEnter = useKeyboardAwareMouseEnter(setSelectedIndex)

  return (
    <PopoverItem
      key={tag}
      rootOnly
      active={globalIndex === selectedIndex && globalIndex >= 0}
      onMouseEnter={() => handleMouseEnter(globalIndex)}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleTagSelect(tag)
      }}
      ref={(el) => {
        if (el) {
          itemRefs.current?.set(tag, el)
        }
      }}
    >
      <span className='flex-1 truncate'>
        {tag.startsWith(TAG_PREFIXES.VARIABLE) ? tag.substring(TAG_PREFIXES.VARIABLE.length) : tag}
      </span>
      {variableInfo && (
        <span className='ml-auto text-[10px] text-[var(--text-muted-inverse)]'>
          {variableInfo.type}
        </span>
      )}
    </PopoverItem>
  )
}

/**
 * Wrapper for block root tag items that has access to popover context
 */
const BlockRootTagItem: React.FC<{
  rootTag: string
  rootTagGlobalIndex: number
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  handleTagSelect: (tag: string, group?: BlockTagGroup) => void
  itemRefs: React.RefObject<Map<string, HTMLElement>>
  group: BlockTagGroup
  tagIcon: string | React.ComponentType<{ className?: string }>
  blockColor: string
  blockName: string
}> = ({
  rootTag,
  rootTagGlobalIndex,
  selectedIndex,
  setSelectedIndex,
  handleTagSelect,
  itemRefs,
  group,
  tagIcon,
  blockColor,
  blockName,
}) => {
  const handleMouseEnter = useKeyboardAwareMouseEnter(setSelectedIndex)

  return (
    <PopoverItem
      rootOnly
      active={rootTagGlobalIndex === selectedIndex && rootTagGlobalIndex >= 0}
      onMouseEnter={() => handleMouseEnter(rootTagGlobalIndex)}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleTagSelect(rootTag, group)
      }}
      ref={(el) => {
        if (el) {
          itemRefs.current?.set(rootTag, el)
        }
      }}
    >
      <TagIcon icon={tagIcon} color={blockColor} />
      <span className='flex-1 truncate font-medium'>{blockName}</span>
    </PopoverItem>
  )
}

/**
 * Helper component to capture popover context for nested navigation
 */
const PopoverContextCapture: React.FC<{
  contextRef: React.RefObject<{
    openFolder: (id: string, title: string, onLoad?: () => void, onSelect?: () => void) => void
  } | null>
}> = ({ contextRef }) => {
  const { openFolder } = usePopoverContext()
  useEffect(() => {
    if (contextRef && 'current' in contextRef) {
      ;(contextRef as { current: typeof contextRef.current }).current = { openFolder }
    }
  }, [openFolder, contextRef])
  return null
}

/**
 * Back button that handles nested navigation.
 * When in nested folders, goes back one level at a time.
 * At the root folder level, closes the folder.
 */
const TagDropdownBackButton: React.FC<{ setSelectedIndex: (index: number) => void }> = ({
  setSelectedIndex,
}) => {
  const { isInFolder, closeFolder, size, isKeyboardNav, setKeyboardNav } = usePopoverContext()
  const nestedNav = useNestedNavigation()

  if (!isInFolder) return null

  const handleBackClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (nestedNav?.navigateBack()) {
      return
    }
    closeFolder()
  }

  const handleMouseEnter = () => {
    if (isKeyboardNav) return
    setKeyboardNav(false)
    setSelectedIndex(-1)
  }

  return (
    <PopoverItem
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleBackClick(e)
      }}
      onMouseEnter={handleMouseEnter}
    >
      <svg
        className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        fill='none'
        viewBox='0 0 24 24'
        stroke='currentColor'
      >
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 19l-7-7 7-7' />
      </svg>
      <span className='shrink-0'>Back</span>
    </PopoverItem>
  )
}

/**
 * TagDropdown component that displays available tags for selection in input fields.
 *
 * @remarks
 * Displays variables and block outputs that can be referenced in workflow inputs.
 * Uses the Popover component system for consistent styling and positioning.
 * Supports keyboard navigation, search filtering, and nested folder views.
 *
 * @example
 * ```tsx
 * <TagDropdown
 *   visible={showDropdown}
 *   onSelect={handleTagSelect}
 *   blockId={currentBlockId}
 *   activeSourceBlockId={null}
 *   inputValue={inputText}
 *   cursorPosition={cursor}
 *   onClose={() => setShowDropdown(false)}
 *   inputRef={textareaRef}
 * />
 * ```
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
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())

  const [nestedPath, setNestedPath] = useState<NestedTag[]>([])
  const baseFolderRef = useRef<{
    id: string
    title: string
    baseTag: NestedTag
    group: NestedBlockTagGroup
  } | null>(null)
  const handleTagSelectRef = useRef<((tag: string, group?: BlockTagGroup) => void) | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const inputValueRef = useRef(inputValue)
  const cursorPositionRef = useRef(cursorPosition)
  inputValueRef.current = inputValue
  cursorPositionRef.current = cursorPosition

  const { blocks, edges, loops, parallels } = useWorkflowStore(
    useShallow((state) => ({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
    }))
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

  const emptyVariableInfoMap: Record<string, { type: string; id: string }> = {}

  /**
   * Computes tags, variable info, and block tag groups
   */
  const { tags, variableInfoMap, blockTagGroups } = useMemo<TagComputationResult>(() => {
    if (activeSourceBlockId) {
      const sourceBlock = blocks[activeSourceBlockId]
      if (!sourceBlock) {
        return { tags: [], variableInfoMap: emptyVariableInfoMap, blockTagGroups: [] }
      }

      const blockConfig = getBlock(sourceBlock.type)

      if (!blockConfig) {
        if (sourceBlock.type === 'loop' || sourceBlock.type === 'parallel') {
          const mockConfig = { outputs: { results: 'array' } }
          const blockName = sourceBlock.name || sourceBlock.type
          const normalizedBlockName = normalizeName(blockName)

          const outputPaths = getOutputPathsFromSchema(mockConfig.outputs)
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

          return { tags: blockTags, variableInfoMap: emptyVariableInfoMap, blockTagGroups }
        }
        return { tags: [], variableInfoMap: emptyVariableInfoMap, blockTagGroups: [] }
      }

      const blockName = sourceBlock.name || sourceBlock.type
      const normalizedBlockName = normalizeName(blockName)

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
        } else if (sourceBlock.type === 'human_in_the_loop') {
          const dynamicOutputs = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)

          const isSelfReference = activeSourceBlockId === blockId

          if (dynamicOutputs.length > 0) {
            const allTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference
              ? allTags.filter((tag) => tag.endsWith('.url') || tag.endsWith('.resumeEndpoint'))
              : allTags
          } else {
            const outputPaths = getBlockOutputPaths(sourceBlock.type, mergedSubBlocks)
            const allTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference
              ? allTags.filter((tag) => tag.endsWith('.url') || tag.endsWith('.resumeEndpoint'))
              : allTags
          }
        } else {
          const toolOutputPaths = getToolOutputPaths(blockConfig, mergedSubBlocks)

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

      return { tags: blockTags, variableInfoMap: emptyVariableInfoMap, blockTagGroups }
    }

    const hasInvalidBlocks = Object.values(blocks).some((block) => !block || !block.type)
    if (hasInvalidBlocks) {
      return { tags: [], variableInfoMap: emptyVariableInfoMap, blockTagGroups: [] }
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
      (variable: Variable) => `${TAG_PREFIXES.VARIABLE}${normalizeName(variable.name)}`
    )

    const variableInfoMap = validVariables.reduce(
      (acc, variable) => {
        const tagName = `${TAG_PREFIXES.VARIABLE}${normalizeName(variable.name)}`
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

      const loopBlock = blocks[blockId]
      if (loopBlock) {
        const loopBlockName = loopBlock.name || loopBlock.type
        const normalizedLoopName = normalizeName(loopBlockName)
        const contextualTags: string[] = [`${normalizedLoopName}.index`]
        if (loopType === 'forEach') {
          contextualTags.push(`${normalizedLoopName}.currentItem`)
          contextualTags.push(`${normalizedLoopName}.items`)
        }

        loopBlockGroup = {
          blockName: loopBlockName,
          blockId: blockId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0,
          isContextual: true,
        }
      }
    } else if (containingLoop) {
      const [loopId, loop] = containingLoop
      containingLoopBlockId = loopId
      const loopType = loop.loopType || 'for'

      const containingLoopBlock = blocks[loopId]
      if (containingLoopBlock) {
        const loopBlockName = containingLoopBlock.name || containingLoopBlock.type
        const normalizedLoopName = normalizeName(loopBlockName)
        const contextualTags: string[] = [`${normalizedLoopName}.index`]
        if (loopType === 'forEach') {
          contextualTags.push(`${normalizedLoopName}.currentItem`)
          contextualTags.push(`${normalizedLoopName}.items`)
        }

        loopBlockGroup = {
          blockName: loopBlockName,
          blockId: loopId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0,
          isContextual: true,
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

      const containingParallelBlock = blocks[parallelId]
      if (containingParallelBlock) {
        const parallelBlockName = containingParallelBlock.name || containingParallelBlock.type
        const normalizedParallelName = normalizeName(parallelBlockName)
        const contextualTags: string[] = [`${normalizedParallelName}.index`]
        if (parallelType === 'collection') {
          contextualTags.push(`${normalizedParallelName}.currentItem`)
          contextualTags.push(`${normalizedParallelName}.items`)
        }

        parallelBlockGroup = {
          blockName: parallelBlockName,
          blockId: parallelId,
          blockType: 'parallel',
          tags: contextualTags,
          distance: 0,
          isContextual: true,
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
      // Exception: human_in_the_loop blocks can reference their own outputs (url, resumeEndpoint)
      if (accessibleBlockId === blockId && accessibleBlock.type !== 'human_in_the_loop') continue

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
          const normalizedBlockName = normalizeName(blockName)

          const outputPaths = getOutputPathsFromSchema(mockConfig.outputs)
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
      const normalizedBlockName = normalizeName(blockName)

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
        } else if (accessibleBlock.type === 'human_in_the_loop') {
          const dynamicOutputs = getBlockOutputPaths(accessibleBlock.type, mergedSubBlocks)

          const isSelfReference = accessibleBlockId === blockId

          if (dynamicOutputs.length > 0) {
            const allTags = dynamicOutputs.map((path) => `${normalizedBlockName}.${path}`)
            blockTags = isSelfReference
              ? allTags.filter((tag) => tag.endsWith('.url') || tag.endsWith('.resumeEndpoint'))
              : allTags
          } else {
            blockTags = [`${normalizedBlockName}.url`, `${normalizedBlockName}.resumeEndpoint`]
          }
        } else {
          const toolOutputPaths = getToolOutputPaths(blockConfig, mergedSubBlocks)

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

    const groupTags = finalBlockTagGroups.flatMap((group) => group.tags)
    const tags = [...groupTags, ...variableTags]

    return {
      tags,
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
    return tags.filter((tag: string) => tag.toLowerCase().includes(searchTerm))
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
      const normalizedBlockName = normalizeName(group.blockName)
      const directTags: NestedTag[] = []
      const tagsForTree: string[] = []

      group.tags.forEach((tag: string) => {
        const tagParts = tag.split('.')

        if (tagParts.length === 1) {
          directTags.push({
            key: tag,
            display: tag,
            fullTag: tag,
          })
        } else if (tagParts.length === 2) {
          directTags.push({
            key: tagParts[1],
            display: tagParts[1],
            fullTag: tag,
          })
        } else {
          tagsForTree.push(tag)
        }
      })

      const nestedTags = [...directTags, ...buildNestedTagTree(tagsForTree, normalizedBlockName)]

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

    const flattenNestedTag = (nestedTag: NestedTag, group: BlockTagGroup, rootTag: string) => {
      if (nestedTag.fullTag === rootTag) {
        return
      }

      if (nestedTag.parentTag) {
        list.push({ tag: nestedTag.parentTag, group })
      }

      if (nestedTag.fullTag && !nestedTag.children && !nestedTag.nestedChildren) {
        list.push({ tag: nestedTag.fullTag, group })
      }

      if (nestedTag.children) {
        nestedTag.children.forEach((child) => {
          list.push({ tag: child.fullTag, group })
        })
      }

      if (nestedTag.nestedChildren) {
        nestedTag.nestedChildren.forEach((nestedChild) => {
          flattenNestedTag(nestedChild, group, rootTag)
        })
      }
    }

    nestedBlockTagGroups.forEach((group) => {
      const normalizedBlockName = normalizeName(group.blockName)
      const rootTagFromTags = group.tags.find((tag) => tag === normalizedBlockName)
      const rootTag = rootTagFromTags || normalizedBlockName

      list.push({ tag: rootTag, group })

      group.nestedTags.forEach((nestedTag) => {
        flattenNestedTag(nestedTag, group, rootTag)
      })
    })

    return list
  }, [variableTags, nestedBlockTagGroups])

  const flatTagIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatTagList.forEach((item, index) => {
      map.set(item.tag, index)
    })
    return map
  }, [flatTagList])

  const handleTagSelect = useCallback(
    (tag: string, blockGroup?: BlockTagGroup) => {
      let liveCursor = cursorPositionRef.current
      let liveValue = inputValueRef.current

      if (typeof window !== 'undefined' && document?.activeElement) {
        const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        if (activeEl && typeof activeEl.selectionStart === 'number') {
          liveCursor = activeEl.selectionStart ?? cursorPositionRef.current
          if ('value' in activeEl && typeof activeEl.value === 'string') {
            liveValue = activeEl.value
          }
        }
      }

      const textBeforeCursor = liveValue.slice(0, liveCursor)
      const textAfterCursor = liveValue.slice(liveCursor)

      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

      let processedTag = tag

      const parts = tag.split('.')
      if (parts.length >= 3 && blockGroup) {
        const arrayFieldName = parts[1]
        const block = useWorkflowStore.getState().blocks[blockGroup.blockId]
        const blockConfig = block ? (getBlock(block.type) ?? null) : null
        const mergedSubBlocks = getMergedSubBlocks(blockGroup.blockId)

        const fieldType = getOutputTypeForPath(
          block,
          blockConfig,
          blockGroup.blockId,
          arrayFieldName,
          mergedSubBlocks
        )

        if (fieldType === 'file' || fieldType === 'file[]' || fieldType === 'array') {
          const blockName = parts[0]
          const remainingPath = parts.slice(2).join('.')
          processedTag = `${blockName}.${arrayFieldName}[0].${remainingPath}`
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
        blockGroup?.isContextual &&
        (blockGroup.blockType === 'loop' || blockGroup.blockType === 'parallel')
      ) {
        const tagParts = tag.split('.')
        if (tagParts.length === 1) {
          processedTag = blockGroup.blockType
        } else {
          const lastPart = tagParts[tagParts.length - 1]
          if (['index', 'currentItem', 'items'].includes(lastPart)) {
            processedTag = `${blockGroup.blockType}.${lastPart}`
          } else {
            processedTag = tag
          }
        }
      }

      let newValue: string

      if (lastOpenBracket === -1) {
        // No '<' found - insert the full tag at cursor position
        newValue = `${textBeforeCursor}<${processedTag}>${textAfterCursor}`
      } else {
        // '<' found - replace from '<' to cursor (and consume trailing '>' if present)
        const nextCloseBracket = textAfterCursor.indexOf('>')
        let remainingTextAfterCursor = textAfterCursor

        if (nextCloseBracket !== -1) {
          const textBetween = textAfterCursor.slice(0, nextCloseBracket)
          if (/^[a-zA-Z0-9._]*$/.test(textBetween)) {
            remainingTextAfterCursor = textAfterCursor.slice(nextCloseBracket + 1)
          }
        }

        newValue = `${textBeforeCursor.slice(0, lastOpenBracket)}<${processedTag}>${remainingTextAfterCursor}`
      }

      onSelect(newValue)
      onClose?.()
    },
    [workflowVariables, onSelect, onClose, getMergedSubBlocks]
  )

  handleTagSelectRef.current = handleTagSelect

  const popoverContextRef = useRef<{
    openFolder: (id: string, title: string, onLoad?: () => void, onSelect?: () => void) => void
  } | null>(null)

  const nestedNavigationValue = useMemo<NestedNavigationContextValue>(
    () => ({
      nestedPath,
      navigateIn: (tag: NestedTag, group: NestedBlockTagGroup) => {
        const baseFolder = baseFolderRef.current
        if (!baseFolder || !popoverContextRef.current) return

        setNestedPath((prev) => [...prev, tag])

        if (scrollAreaRef.current) {
          scrollAreaRef.current.scrollTop = 0
        }

        const selectionCallback = () => {
          if (tag.parentTag && handleTagSelectRef.current) {
            handleTagSelectRef.current(tag.parentTag, group)
          }
        }
        popoverContextRef.current.openFolder(
          baseFolder.id,
          tag.display,
          undefined,
          selectionCallback
        )
      },
      navigateBack: () => {
        const baseFolder = baseFolderRef.current
        if (!baseFolder || !popoverContextRef.current) return false
        if (nestedPath.length === 0) return false

        const newPath = nestedPath.slice(0, -1)
        setNestedPath(newPath)

        if (newPath.length === 0) {
          const selectionCallback = () => {
            if (baseFolder.baseTag.parentTag && handleTagSelectRef.current) {
              handleTagSelectRef.current(baseFolder.baseTag.parentTag, baseFolder.group)
            }
          }
          popoverContextRef.current.openFolder(
            baseFolder.id,
            baseFolder.title,
            undefined,
            selectionCallback
          )
        } else {
          const parentTag = newPath[newPath.length - 1]
          const selectionCallback = () => {
            if (parentTag.parentTag && handleTagSelectRef.current) {
              handleTagSelectRef.current(parentTag.parentTag, baseFolder.group)
            }
          }
          popoverContextRef.current.openFolder(
            baseFolder.id,
            parentTag.display,
            undefined,
            selectionCallback
          )
        }
        return true
      },
      registerFolder: (folderId, folderTitle, baseTag, group) => {
        baseFolderRef.current = { id: folderId, title: folderTitle, baseTag, group }
      },
    }),
    [nestedPath]
  )

  useEffect(() => {
    if (!visible) {
      setNestedPath([])
      baseFolderRef.current = null
    }
  }, [visible])

  useEffect(() => {
    setSelectedIndex(0)
  }, [flatTagList.length])

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
    <NestedNavigationContext.Provider value={nestedNavigationValue}>
      <Popover open={visible} onOpenChange={(open) => !open && onClose?.()} colorScheme='inverted'>
        <PopoverContextCapture contextRef={popoverContextRef} />
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
          onFolderEnter={() => {
            if (scrollAreaRef.current) {
              scrollAreaRef.current.scrollTop = 0
            }
          }}
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
          <PopoverScrollArea ref={scrollAreaRef}>
            <TagDropdownBackButton setSelectedIndex={setSelectedIndex} />
            {flatTagList.length === 0 ? (
              <div className='px-[6px] py-[8px] text-[12px] text-[var(--white)]/60'>
                No matching tags found
              </div>
            ) : (
              <>
                {variableTags.length > 0 && (
                  <>
                    <PopoverSection rootOnly>
                      <div className='flex items-center gap-[6px]'>
                        <TagIcon icon='V' color={BLOCK_COLORS.VARIABLE} />
                        Variables
                      </div>
                    </PopoverSection>
                    {variableTags.map((tag: string) => {
                      const variableInfo = variableInfoMap?.[tag] || null
                      const globalIndex = flatTagIndexMap.get(tag) ?? -1

                      return (
                        <VariableTagItem
                          key={tag}
                          tag={tag}
                          globalIndex={globalIndex}
                          selectedIndex={selectedIndex}
                          setSelectedIndex={setSelectedIndex}
                          handleTagSelect={handleTagSelect}
                          itemRefs={itemRefs}
                          variableInfo={variableInfo}
                        />
                      )
                    })}
                    {nestedBlockTagGroups.length > 0 && <PopoverDivider rootOnly />}
                  </>
                )}

                {nestedBlockTagGroups.map((group: NestedBlockTagGroup, groupIndex: number) => {
                  const blockConfig = getBlock(group.blockType)
                  let blockColor = blockConfig?.bgColor || BLOCK_COLORS.DEFAULT

                  if (group.blockType === 'loop') {
                    blockColor = BLOCK_COLORS.LOOP
                  } else if (group.blockType === 'parallel') {
                    blockColor = BLOCK_COLORS.PARALLEL
                  }

                  let tagIcon: string | React.ComponentType<{ className?: string }> =
                    group.blockName.charAt(0).toUpperCase()
                  if (blockConfig?.icon) {
                    tagIcon = blockConfig.icon
                  } else if (group.blockType === 'loop') {
                    tagIcon = RepeatIcon
                  } else if (group.blockType === 'parallel') {
                    tagIcon = SplitIcon
                  }

                  const normalizedBlockName = normalizeName(group.blockName)
                  const rootTagFromTags = group.tags.find((tag) => tag === normalizedBlockName)
                  const rootTag = rootTagFromTags || normalizedBlockName

                  const rootTagGlobalIndex = flatTagIndexMap.get(rootTag) ?? -1

                  return (
                    <div key={group.blockId}>
                      <BlockRootTagItem
                        rootTag={rootTag}
                        rootTagGlobalIndex={rootTagGlobalIndex}
                        selectedIndex={selectedIndex}
                        setSelectedIndex={setSelectedIndex}
                        handleTagSelect={handleTagSelect}
                        itemRefs={itemRefs}
                        group={group}
                        tagIcon={tagIcon}
                        blockColor={blockColor}
                        blockName={group.blockName}
                      />
                      {group.nestedTags.map((nestedTag) => {
                        if (nestedTag.fullTag === rootTag) {
                          return null
                        }

                        return (
                          <NestedTagRenderer
                            key={`${group.blockId}-${nestedTag.key}`}
                            nestedTag={nestedTag}
                            group={group}
                            flatTagList={flatTagList}
                            flatTagIndexMap={flatTagIndexMap}
                            selectedIndex={selectedIndex}
                            setSelectedIndex={setSelectedIndex}
                            handleTagSelect={handleTagSelect}
                            itemRefs={itemRefs}
                            blocks={blocks}
                            getMergedSubBlocks={getMergedSubBlocks}
                          />
                        )
                      })}
                      {groupIndex < nestedBlockTagGroups.length - 1 && <PopoverDivider rootOnly />}
                    </div>
                  )
                })}
              </>
            )}
          </PopoverScrollArea>
        </PopoverContent>
      </Popover>
    </NestedNavigationContext.Provider>
  )
}
