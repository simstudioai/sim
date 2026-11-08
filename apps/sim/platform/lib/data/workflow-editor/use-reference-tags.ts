import { useCallback, useMemo, useRef } from 'react'
import {
  getEffectiveBlockOutputType,
  getOutputPathsFromSchema,
} from '@/lib/workflows/blocks/outputs'
import { getBlockReferenceTags } from '@/lib/workflows/blocks/reference-tags'
import { hasTriggerCapability } from '@/lib/workflows/triggers/utils'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWorkflowReferenceScope } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/workflow-reference-scope'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { isHumanInTheLoopBlock, normalizeName } from '@/executor/constants'
import { getTagSearchTerm } from '@/platform/lib/data/workflow-editor/reference-triggers'
import type { Variable } from '@/stores/variables/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** A block whose outputs the field may reference, with its tags in display order. */
export interface BlockTagGroup {
  blockName: string
  blockId: string
  blockType: string
  tags: string[]
  distance: number
  /** A loop or parallel's iteration context, available inside the subflow. */
  isContextual?: boolean
}

/** A leaf under a nested output object. */
interface NestedTagChild {
  key: string
  display: string
  fullTag: string
}

/** One output, or a nested object of outputs the picker opens as a folder. */
export interface NestedTag {
  key: string
  display: string
  fullTag?: string
  parentTag?: string
  children?: NestedTagChild[]
  nestedChildren?: NestedTag[]
}

export interface NestedBlockTagGroup extends BlockTagGroup {
  nestedTags: NestedTag[]
}

/** A block's stored sub-blocks with the live editor values laid over them. */
type MergedSubBlocks = Record<string, { value?: unknown }>

interface TagComputationResult {
  tags: string[]
  variableInfoMap: Record<string, { type: string; id: string }>
  blockTagGroups: BlockTagGroup[]
}

/** Prefix of a workflow variable's reference. */
export const TAG_PREFIXES = {
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

const getOutputTypeForPath = (
  block: BlockState,
  blockConfig: BlockConfig | null,
  outputPath: string,
  subBlocks: MergedSubBlocks
): string => {
  if (block?.type === 'variables') {
    return 'any'
  }

  const isTriggerCapable = blockConfig ? hasTriggerCapability(blockConfig) : false
  const triggerMode = Boolean(block?.triggerMode && isTriggerCapable)

  return getEffectiveBlockOutputType(block?.type ?? '', outputPath, subBlocks, {
    triggerMode,
    preferToolOutputs: !triggerMode,
  })
}

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
      let node = current.children.get(part)
      if (!node) {
        node = { key: part, children: new Map() }
        current.children.set(part, node)
      }

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
          if (nestedChild.nestedChildren || nestedChild.children || !nestedChild.fullTag) {
            folders.push(nestedChild)
          } else {
            leafChildren.push({
              key: nestedChild.key,
              display: nestedChild.display,
              fullTag: nestedChild.fullTag,
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

interface ReferenceTagsOptions {
  blockId: string
  activeSourceBlockId: string | null
  inputValue: string
  cursorPosition: number
  /** Receives the field's whole new text with the reference in place, and the caret after it. */
  onSelect: (newValue: string, newCursorPosition: number) => void
  onClose?: () => void
}

/**
 * The `<block.output>` references a field may insert: workflow variables, the enclosing loops' and
 * parallels' iteration context, then every reachable block's outputs nested by object path, as the
 * legacy tag dropdown computes them, and how a chosen reference is written into the field.
 */
export function useReferenceTags({
  blockId,
  activeSourceBlockId,
  inputValue,
  cursorPosition,
  onSelect,
  onClose,
}: ReferenceTagsOptions) {
  const inputValueRef = useRef(inputValue)
  const cursorPositionRef = useRef(cursorPosition)
  inputValueRef.current = inputValue
  cursorPositionRef.current = cursorPosition

  // The workflow being referenced — the editor's own on the canvas, a supplied one on a
  // surface configuring a block that lives in another workflow (see `WorkflowReferenceScope`).
  const {
    blocks,
    edges,
    loops,
    parallels,
    workflowId,
    subBlockValues: workflowSubBlockValues,
    variables: workflowVariables,
  } = useWorkflowReferenceScope()
  const rawAccessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const combinedAccessiblePrefixes = useMemo(() => {
    if (!rawAccessiblePrefixes) return new Set<string>()
    return new Set<string>(rawAccessiblePrefixes)
  }, [rawAccessiblePrefixes])

  const getMergedSubBlocks = useCallback(
    (targetBlockId: string): MergedSubBlocks => {
      const base = blocks[targetBlockId]?.subBlocks || {}
      const live = workflowSubBlockValues?.[targetBlockId] || {}
      const merged: MergedSubBlocks = { ...base }
      for (const [subId, liveVal] of Object.entries(live)) {
        merged[subId] = { ...(base[subId] || {}), value: liveVal }
      }
      return merged
    },
    [blocks, workflowSubBlockValues]
  )

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

      const mergedSubBlocks = getMergedSubBlocks(activeSourceBlockId)
      const blockName = sourceBlock.name || sourceBlock.type
      const blockTags = getBlockReferenceTags({
        block: {
          id: activeSourceBlockId,
          type: sourceBlock.type,
          name: sourceBlock.name,
          triggerMode: sourceBlock.triggerMode,
          subBlocks: mergedSubBlocks,
        },
        currentBlockId: blockId,
        subBlocks: mergedSubBlocks,
      })

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

      for (let next = queue.shift(); next; next = queue.shift()) {
        const [currentNodeId, distance] = next
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

    const loopBlockGroups: BlockTagGroup[] = []
    const ancestorLoopIds = new Set<string>()
    const visitedContainerIds = new Set<string>()

    const findAncestorContainers = (targetId: string) => {
      if (visitedContainerIds.has(targetId)) return
      visitedContainerIds.add(targetId)

      // Check if targetId is directly inside any loop
      for (const [loopId, loop] of Object.entries(loops)) {
        if (loop.nodes.includes(targetId) && !ancestorLoopIds.has(loopId)) {
          ancestorLoopIds.add(loopId)
          const loopBlock = blocks[loopId]
          if (loopBlock) {
            const loopType = loop.loopType || 'for'
            const loopBlockName = loopBlock.name || loopBlock.type
            const normalizedLoopName = normalizeName(loopBlockName)
            const contextualTags: string[] = [`${normalizedLoopName}.index`]
            if (loopType === 'forEach') {
              contextualTags.push(`${normalizedLoopName}.currentItem`)
              contextualTags.push(`${normalizedLoopName}.items`)
            }
            loopBlockGroups.push({
              blockName: loopBlockName,
              blockId: loopId,
              blockType: 'loop',
              tags: contextualTags,
              distance: 0,
              isContextual: true,
            })
          }
          findAncestorContainers(loopId)
        }
      }
      // Also walk through containing parallels so we find loops that contain
      // the parallel (e.g. block inside parallel inside loop)
      for (const [parallelId, parallel] of Object.entries(parallels || {})) {
        if (parallel.nodes.includes(targetId)) {
          findAncestorContainers(parallelId)
        }
      }
    }

    const isLoopBlock = blocks[blockId]?.type === 'loop'
    if (isLoopBlock && loops[blockId]) {
      const loop = loops[blockId]
      ancestorLoopIds.add(blockId)
      const loopBlock = blocks[blockId]
      if (loopBlock) {
        const loopType = loop.loopType || 'for'
        const loopBlockName = loopBlock.name || loopBlock.type
        const normalizedLoopName = normalizeName(loopBlockName)
        const contextualTags: string[] = [`${normalizedLoopName}.index`]
        if (loopType === 'forEach') {
          contextualTags.push(`${normalizedLoopName}.currentItem`)
          contextualTags.push(`${normalizedLoopName}.items`)
        }
        loopBlockGroups.push({
          blockName: loopBlockName,
          blockId: blockId,
          blockType: 'loop',
          tags: contextualTags,
          distance: 0,
          isContextual: true,
        })
      }
      findAncestorContainers(blockId)
    } else {
      findAncestorContainers(blockId)
    }

    const parallelBlockGroups: BlockTagGroup[] = []
    const ancestorParallelIds = new Set<string>()
    const visitedParallelTargets = new Set<string>()

    const findAncestorParallels = (targetId: string) => {
      if (visitedParallelTargets.has(targetId)) return
      visitedParallelTargets.add(targetId)

      for (const [parallelId, parallel] of Object.entries(parallels || {})) {
        if (parallel.nodes.includes(targetId) && !ancestorParallelIds.has(parallelId)) {
          ancestorParallelIds.add(parallelId)
          const parallelBlock = blocks[parallelId]
          if (parallelBlock) {
            const parallelType = parallel.parallelType || 'count'
            const parallelBlockName = parallelBlock.name || parallelBlock.type
            const normalizedParallelName = normalizeName(parallelBlockName)
            const contextualTags: string[] = [`${normalizedParallelName}.index`]
            if (parallelType === 'collection') {
              contextualTags.push(`${normalizedParallelName}.currentItem`)
              contextualTags.push(`${normalizedParallelName}.items`)
            }
            parallelBlockGroups.push({
              blockName: parallelBlockName,
              blockId: parallelId,
              blockType: 'parallel',
              tags: contextualTags,
              distance: 0,
              isContextual: true,
            })
          }
          // Walk up through containing loops and parallels
          for (const [loopId, loop] of Object.entries(loops)) {
            if (loop.nodes.includes(parallelId)) {
              findAncestorParallels(loopId)
            }
          }
          findAncestorParallels(parallelId)
        }
      }
    }

    findAncestorParallels(blockId)
    // Also check through ancestor loops (a block in a loop that's in a parallel)
    for (const loopId of ancestorLoopIds) {
      findAncestorParallels(loopId)
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
      // Exception: Human blocks can reference their own outputs (url, resumeEndpoint)
      if (accessibleBlockId === blockId && !isHumanInTheLoopBlock(accessibleBlock.type)) continue

      const blockConfig = getBlock(accessibleBlock.type)

      if (!blockConfig) {
        if (accessibleBlock.type === 'loop' || accessibleBlock.type === 'parallel') {
          if (
            ancestorLoopIds.has(accessibleBlockId) ||
            ancestorParallelIds.has(accessibleBlockId)
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

      const mergedSubBlocks = getMergedSubBlocks(accessibleBlockId)
      const blockName = accessibleBlock.name || accessibleBlock.type
      const blockTags = getBlockReferenceTags({
        block: {
          id: accessibleBlockId,
          type: accessibleBlock.type,
          name: accessibleBlock.name,
          triggerMode: accessibleBlock.triggerMode,
          subBlocks: mergedSubBlocks,
        },
        currentBlockId: blockId,
        subBlocks: mergedSubBlocks,
      })

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
    finalBlockTagGroups.push(...loopBlockGroups)
    finalBlockTagGroups.push(...parallelBlockGroups)

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
        const block = blocks[blockGroup.blockId]
        const blockConfig = block ? (getBlock(block.type) ?? null) : null
        const mergedSubBlocks = getMergedSubBlocks(blockGroup.blockId)

        const fieldType = getOutputTypeForPath(block, blockConfig, arrayFieldName, mergedSubBlocks)

        if (fieldType === 'file' || fieldType === 'file[]' || fieldType === 'array') {
          const blockName = parts[0]
          const remainingPath = parts.slice(2).join('.')
          processedTag = `${blockName}.${arrayFieldName}[0].${remainingPath}`
        }
      }

      if (tag.startsWith(TAG_PREFIXES.VARIABLE)) {
        const variableName = tag.substring(TAG_PREFIXES.VARIABLE.length)
        const variableObj = workflowVariables.find(
          (v: Variable) => normalizeName(v.name) === variableName
        )

        if (variableObj) {
          processedTag = tag
        }
      }

      let newValue: string
      let insertStart: number

      if (lastOpenBracket === -1) {
        // No '<' found - insert the full tag at cursor position
        newValue = `${textBeforeCursor}<${processedTag}>${textAfterCursor}`
        insertStart = liveCursor
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
        insertStart = lastOpenBracket
      }

      const newCursorPos = insertStart + 1 + processedTag.length + 1
      onSelect(newValue, newCursorPos)
      onClose?.()
    },
    [workflowVariables, onSelect, onClose, getMergedSubBlocks]
  )

  const getTagType = useCallback(
    (tag: string, group: BlockTagGroup, key?: string): string => {
      if (
        (group.blockType === 'loop' || group.blockType === 'parallel') &&
        key &&
        !key.includes('.')
      ) {
        if (key === 'index') return 'number'
        if (key === 'currentItem') return 'any'
        if (key === 'items') return 'array'
      }
      const block = blocks[group.blockId]
      if (!block) return ''
      const outputPath = tag.split('.').slice(1).join('.')
      return getOutputTypeForPath(
        block,
        getBlock(block.type) ?? null,
        outputPath,
        getMergedSubBlocks(group.blockId)
      )
    },
    [blocks, getMergedSubBlocks]
  )

  return {
    tags,
    variableTags,
    variableInfoMap,
    nestedBlockTagGroups,
    flatTagList,
    flatTagIndexMap,
    handleTagSelect,
    getTagType,
  }
}

/** The tag that names a whole block, the first row of its group. */
export function rootTagOf(group: BlockTagGroup): string {
  const normalizedBlockName = normalizeName(group.blockName)
  return group.tags.find((tag) => tag === normalizedBlockName) ?? normalizedBlockName
}
