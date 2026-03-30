import type React from 'react'
import { useCallback } from 'react'
import type { Edge, Node } from 'reactflow'
import type { SubflowNodeData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { isAnnotationOnlyBlock } from '@/executor/constants'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
}

interface UseAutoConnectProps {
  blocksRef: React.RefObject<Record<string, BlockState>>
  getNodes: () => Node[]
  getNodeAnchorPosition: (id: string) => { x: number; y: number }
  isPointInLoopNode: (position: { x: number; y: number }) => {
    loopId: string
    loopPosition: { x: number; y: number }
    dimensions: { width: number; height: number }
  } | null
  autoConnectRef: React.RefObject<boolean>
}

export function useAutoConnectEdge({
  blocksRef,
  getNodes,
  getNodeAnchorPosition,
  isPointInLoopNode,
  autoConnectRef,
}: UseAutoConnectProps) {
  const isAutoConnectSourceCandidate = useCallback((block: BlockState): boolean => {
    if (!block.enabled) return false
    if (block.type === 'response') return false
    if (isAnnotationOnlyBlock(block.type)) return false
    return true
  }, [])

  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }): BlockData | null => {
      const currentBlocks = blocksRef.current
      const containerAtPoint = isPointInLoopNode(newNodePosition)
      const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

      const closest = Object.entries(currentBlocks).reduce<{
        id: string
        type: string
        position: { x: number; y: number }
        distanceSquared: number
      } | null>((acc, [id, block]) => {
        if (!isAutoConnectSourceCandidate(block)) return acc
        const node = nodeIndex.get(id)
        if (!node) return acc

        const blockParentId = currentBlocks[id]?.data?.parentId
        const dropParentId = containerAtPoint?.loopId
        if (dropParentId !== blockParentId) return acc

        const anchor = getNodeAnchorPosition(id)
        const distanceSquared =
          (anchor.x - newNodePosition.x) ** 2 + (anchor.y - newNodePosition.y) ** 2
        if (!acc || distanceSquared < acc.distanceSquared) {
          return {
            id,
            type: block.type,
            position: anchor,
            distanceSquared,
          }
        }
        return acc
      }, null)

      if (!closest) return null

      return {
        id: closest.id,
        type: closest.type,
        position: closest.position,
      }
    },
    [getNodes, getNodeAnchorPosition, isPointInLoopNode, isAutoConnectSourceCandidate]
  )

  const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
    if (block.type === 'condition') {
      const conditionHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
      )
      if (conditionHandles.length > 0) {
        const handleId = conditionHandles[0].getAttribute('data-handleid')
        if (handleId) return handleId
      }
    } else if (block.type === 'router_v2') {
      const routerHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="router-"]`
      )
      if (routerHandles.length > 0) {
        const handleId = routerHandles[0].getAttribute('data-handleid')
        if (handleId) return handleId
      }
    } else if (block.type === 'loop') {
      return 'loop-end-source'
    } else if (block.type === 'parallel') {
      return 'parallel-end-source'
    }
    return 'source'
  }, [])

  const createEdgeObject = useCallback(
    (sourceId: string, targetId: string, sourceHandle: string): Edge => {
      return {
        id: crypto.randomUUID(),
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle: 'target',
        type: 'workflowEdge',
      }
    },
    []
  )

  const getContainerStartHandle = useCallback(
    (containerId: string): string => {
      const containerNode = getNodes().find((n) => n.id === containerId)
      return (containerNode?.data as SubflowNodeData)?.kind === 'loop'
        ? 'loop-start-source'
        : 'parallel-start-source'
    },
    [getNodes]
  )

  const findClosestBlockInSet = useCallback(
    (
      candidateBlocks: { id: string; type: string; position: { x: number; y: number } }[],
      targetPosition: { x: number; y: number }
    ): { id: string; type: string; position: { x: number; y: number } } | undefined => {
      const currentBlocks = blocksRef.current
      const closest = candidateBlocks.reduce<{
        id: string
        type: string
        position: { x: number; y: number }
        distanceSquared: number
      } | null>((acc, block) => {
        const blockState = currentBlocks[block.id]
        if (!blockState || !isAutoConnectSourceCandidate(blockState)) return acc
        const distanceSquared =
          (block.position.x - targetPosition.x) ** 2 + (block.position.y - targetPosition.y) ** 2
        if (!acc || distanceSquared < acc.distanceSquared) {
          return { ...block, distanceSquared }
        }
        return acc
      }, null)

      return closest
        ? {
            id: closest.id,
            type: closest.type,
            position: closest.position,
          }
        : undefined
    },
    [isAutoConnectSourceCandidate]
  )

  const tryCreateAutoConnectEdge = useCallback(
    (
      position: { x: number; y: number },
      targetBlockId: string,
      options: {
        targetParentId?: string | null
        existingChildBlocks?: { id: string; type: string; position: { x: number; y: number } }[]
        containerId?: string
      }
    ): Edge | undefined => {
      if (!autoConnectRef.current) return undefined

      if (options.existingChildBlocks && options.existingChildBlocks.length > 0) {
        const closestBlock = findClosestBlockInSet(options.existingChildBlocks, position)
        if (closestBlock) {
          const sourceHandle = determineSourceHandle({
            id: closestBlock.id,
            type: closestBlock.type,
          })
          return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
        }
        return undefined
      }

      if (
        options.containerId &&
        (!options.existingChildBlocks || options.existingChildBlocks.length === 0)
      ) {
        const startHandle = getContainerStartHandle(options.containerId)
        return createEdgeObject(options.containerId, targetBlockId, startHandle)
      }

      const closestBlock = findClosestOutput(position)
      if (!closestBlock) return undefined

      const closestBlockParentId = blocksRef.current[closestBlock.id]?.data?.parentId
      if (closestBlockParentId && !options.targetParentId) {
        return undefined
      }

      const sourceHandle = determineSourceHandle(closestBlock)
      return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
    },
    [
      findClosestOutput,
      determineSourceHandle,
      createEdgeObject,
      getContainerStartHandle,
      findClosestBlockInSet,
    ]
  )

  return { tryCreateAutoConnectEdge }
}
