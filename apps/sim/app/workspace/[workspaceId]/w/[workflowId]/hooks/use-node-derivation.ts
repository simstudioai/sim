import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { Node } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import {
  estimateBlockDimensions,
  isBlockProtected,
  resolveSelectionConflicts,
  syncPanelWithSelection,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { CHILD_EXTENT } from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-constants'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('NodeDerivation')

interface UseNodeDerivationProps {
  blocks: Record<string, BlockState>
  embedded?: boolean
  pendingSelection: string[] | null
  clearPendingSelection: () => void
  sandbox?: boolean
}

interface UseNodeDerivationReturn {
  displayNodes: Node[]
  setDisplayNodes: React.Dispatch<React.SetStateAction<Node[]>>
  blocksStructureHash: string
  derivedNodes: Node[]
  nodesForRender: Node[]
  nodeMap: Map<string, Node>
  selectedNodeIds: string[]
  selectedNodeIdsKey: string
  elevatedNodeIdSet: Set<string>
  lastInteractedNodeId: string | null
  getBlockConfig: (type: string) => ReturnType<typeof getBlock>
}

export function useNodeDerivation({
  blocks,
  embedded,
  pendingSelection,
  clearPendingSelection,
  sandbox,
}: UseNodeDerivationProps): UseNodeDerivationReturn {
  const blockConfigCache = useRef<Map<string, ReturnType<typeof getBlock>>>(new Map())
  const getBlockConfig = useCallback((type: string) => {
    if (!blockConfigCache.current.has(type)) {
      blockConfigCache.current.set(type, getBlock(type))
    }
    return blockConfigCache.current.get(type)
  }, [])

  const prevBlocksHashRef = useRef<string>('')
  const prevBlocksRef = useRef(blocks)

  const blocksStructureHash = useMemo(() => {
    if (prevBlocksRef.current === blocks) {
      return prevBlocksHashRef.current
    }

    prevBlocksRef.current = blocks
    const hash = Object.values(blocks)
      .map((b) => {
        const width = typeof b.data?.width === 'number' ? b.data.width : ''
        const height = typeof b.data?.height === 'number' ? b.data.height : ''
        return `${b.id}:${b.type}:${b.name}:${b.height}:${b.data?.parentId || ''}:${width}:${height}`
      })
      .join('|')

    prevBlocksHashRef.current = hash
    return hash
  }, [blocks])

  const derivedNodes = useMemo(() => {
    const nodeArray: Node[] = []

    Object.entries(blocks).forEach(([, block]) => {
      if (!block || !block.type || !block.name) {
        return
      }

      if (block.type === 'loop' || block.type === 'parallel') {
        let depth = 0
        let pid = block.data?.parentId as string | undefined
        while (pid && depth < 100) {
          depth++
          pid = blocks[pid]?.data?.parentId as string | undefined
        }
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: block.position,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          dragHandle: '.workflow-drag-handle',
          draggable: !isBlockProtected(block.id, blocks),
          zIndex: depth,
          className: block.data?.parentId ? 'nested-subflow-node' : undefined,
          data: {
            ...block.data,
            name: block.name,
            width: block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            height: block.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
            kind: block.type === 'loop' ? 'loop' : 'parallel',
          },
        })
        return
      }

      const blockConfig = getBlockConfig(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { block })
        return
      }

      const nodeType = block.type === 'note' ? 'noteBlock' : 'workflowBlock'
      const dragHandle = block.type === 'note' ? '.note-drag-handle' : '.workflow-drag-handle'
      const childZIndex = block.data?.parentId ? 1000 : undefined
      const extent = block.data?.parentId ? CHILD_EXTENT : block.data?.extent || undefined

      nodeArray.push({
        id: block.id,
        type: nodeType,
        position: block.position,
        parentId: block.data?.parentId,
        dragHandle,
        draggable: !isBlockProtected(block.id, blocks),
        ...(childZIndex !== undefined && { zIndex: childZIndex }),
        extent,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          ...(embedded && { isEmbedded: true }),
          ...(sandbox && { isSandbox: true }),
        },
        width: BLOCK_DIMENSIONS.FIXED_WIDTH,
        height: block.height
          ? Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT)
          : estimateBlockDimensions(block.type).height,
      })
    })

    return nodeArray
  }, [blocksStructureHash, blocks, getBlockConfig, sandbox, embedded])

  const [displayNodes, setDisplayNodes] = useState<Node[]>([])
  const [lastInteractedNodeId, setLastInteractedNodeId] = useState<string | null>(null)

  const selectedNodeIds = useMemo(
    () => displayNodes.filter((node) => node.selected).map((node) => node.id),
    [displayNodes]
  )
  const selectedNodeIdsKey = selectedNodeIds.join(',')

  useEffect(() => {
    syncPanelWithSelection(selectedNodeIds)
  }, [selectedNodeIdsKey])

  useEffect(() => {
    if (selectedNodeIds.length > 0) {
      setLastInteractedNodeId(selectedNodeIds[selectedNodeIds.length - 1])
    }
  }, [selectedNodeIdsKey])

  useEffect(() => {
    if (pendingSelection && pendingSelection.length > 0) {
      const pendingSet = new Set(pendingSelection)
      clearPendingSelection()

      const withSelection = derivedNodes.map((node) => ({
        ...node,
        selected: pendingSet.has(node.id),
      }))
      const resolved = resolveSelectionConflicts(withSelection, blocks)
      setDisplayNodes(resolved)
      return
    }

    setDisplayNodes((currentNodes) => {
      const selectedIds = new Set(currentNodes.filter((n) => n.selected).map((n) => n.id))
      return derivedNodes.map((node) => ({
        ...node,
        selected: selectedIds.has(node.id),
      }))
    })
  }, [derivedNodes, blocks, pendingSelection, clearPendingSelection])

  const nodesForRender = useMemo(() => {
    return displayNodes.map((node) => {
      if (node.type === 'subflowNode') return node
      const base = node.zIndex ?? 21
      const target = node.selected
        ? base + 10
        : node.id === lastInteractedNodeId
          ? Math.max(base + 1, 22)
          : base
      if (target === (node.zIndex ?? 21)) return node
      return { ...node, zIndex: target }
    })
  }, [displayNodes, lastInteractedNodeId])

  const nodeMap = useMemo(() => new Map(displayNodes.map((n) => [n.id, n])), [displayNodes])

  const elevatedNodeIdSet = useMemo(
    () =>
      new Set(lastInteractedNodeId ? [...selectedNodeIds, lastInteractedNodeId] : selectedNodeIds),
    [selectedNodeIds, lastInteractedNodeId]
  )

  return {
    displayNodes,
    setDisplayNodes,
    blocksStructureHash,
    derivedNodes,
    nodesForRender,
    nodeMap,
    selectedNodeIds,
    selectedNodeIdsKey,
    elevatedNodeIdSet,
    lastInteractedNodeId,
    getBlockConfig,
  }
}
