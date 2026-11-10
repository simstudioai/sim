'use client'

import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import {
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  BLOCK_Z_BASE,
  CANVAS_Z_INDEX_MODE,
  CONTAINER_CHILD_Z_BASE,
  EDGE_Z_BASE,
  EDGE_Z_MAX,
  getEdgeZIndexForTarget,
} from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/canvas-layers'
import { CanvasTokenScope } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/canvas-token-scope'
import { sortNodesParentsFirst } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/node-order'
import { PreviewBlock } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-block'
import { getPreviewBlockDimensions } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-dimensions'
import { PreviewEdge } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-edge'
import { PreviewScope } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-scope'
import { PreviewSubflow } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/preview-subflow'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-preview/workflow-preview.module.css'
import {
  type BlockDiffStatus,
  type BlockState,
  type CanvasPort,
  createLogger,
  normalizeWorkflowEdgeHandles,
  SUBFLOW_CHILD_NODE_CLASS,
  useWorkflowMap,
  useWorkflowScope,
  type VersionEdgeDiffStatus,
  type WorkflowState,
} from '@/platform/lib/data/workflows'

const logger = createLogger('PreviewWorkflow')

/** Delay before fitting the view to a changed node set, letting React Flow measure the nodes. */
const FIT_VIEW_DELAY_MS = 50
const FIT_VIEW_DURATION_MS = 200
/** Debounce for refitting while the container resizes. */
const RESIZE_FIT_DELAY_MS = 100
const RESIZE_FIT_DURATION_MS = 150

/** Execution status for edges/nodes in the preview */
type ExecutionStatus = 'success' | 'error' | 'not-executed'

type CanvasColorMode = 'light' | 'dark'

type CursorStyle = 'default' | 'pointer' | 'grab'

/** The container class that sets each pane cursor, as legacy's `--preview-cursor` did. */
const CURSOR_CLASS: Record<CursorStyle, string | undefined> = {
  default: styles.cursorDefault,
  pointer: styles.cursorPointer,
  grab: styles.cursorGrab,
}

/** Calculates nesting depth, handling nested subflows. */
function calculateNestingDepth(
  block: BlockState,
  blocks: Record<string, BlockState>,
  visited: Set<string> = new Set()
): number {
  const parentId = block.data?.parentId
  if (!parentId) return 0
  if (visited.has(parentId)) return 0

  const parentBlock = blocks[parentId]
  if (!parentBlock) {
    logger.warn('Parent block not found for child block')
    return 0
  }

  visited.add(parentId)
  return 1 + calculateNestingDepth(parentBlock, blocks, visited)
}

interface WorkflowPreviewProps {
  workflowState: WorkflowState
  workspaceId?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultZoom?: number
  fitPadding?: number
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  /** Callback when the canvas (empty area) is clicked */
  onPaneClick?: () => void
  /** Cursor style to show when hovering the canvas */
  cursorStyle?: CursorStyle
  /** Map of executed block IDs to their status for highlighting the execution path */
  executedBlocks?: Record<string, { status: string; output?: unknown }>
  /** Currently selected block ID for highlighting */
  selectedBlockId?: string | null
  /** Skips expensive subblock computations for thumbnails/template previews */
  lightweight?: boolean
  /** Per-block comparison status, keyed by block id, when previewing a version diff */
  blockDiffStatus?: Record<string, BlockDiffStatus>
  /** Per-edge comparison status, keyed by edge id, when previewing a version diff */
  edgeDiffStatus?: Record<string, VersionEdgeDiffStatus>
  /** Sub-block ids that changed on a modified block, keyed by block id */
  changedFieldsByBlock?: Record<string, string[]>
  removedPortsByBlock?: Record<string, CanvasPort[]>
}

/** Preview node types using minimal, hook-free components. */
const previewNodeTypes: NodeTypes = {
  workflowBlock: PreviewBlock,
  noteBlock: PreviewBlock,
  subflowNode: PreviewSubflow,
}

const edgeTypes: EdgeTypes = {
  default: PreviewEdge,
  workflowEdge: PreviewEdge,
}

interface FitViewOnChangeProps {
  nodeIds: string
  fitPadding: number
  containerRef: RefObject<HTMLDivElement | null>
}

/** Calls fitView on node changes or container resize. */
function FitViewOnChange({ nodeIds, fitPadding, containerRef }: FitViewOnChangeProps) {
  const { fitView } = useReactFlow()
  const lastNodeIdsRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nodeIds.length) return
    const shouldFit = lastNodeIdsRef.current !== nodeIds
    if (!shouldFit) return
    lastNodeIdsRef.current = nodeIds

    const timeoutId = setTimeout(() => {
      fitView({ padding: fitPadding, duration: FIT_VIEW_DURATION_MS })
    }, FIT_VIEW_DELAY_MS)
    return () => clearTimeout(timeoutId)
  }, [nodeIds, fitPadding, fitView])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        fitView({ padding: fitPadding, duration: RESIZE_FIT_DURATION_MS })
      }, RESIZE_FIT_DELAY_MS)
    })

    resizeObserver.observe(container)
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [containerRef, fitPadding, fitView])

  return null
}

/**
 * Read-only workflow visualization with execution status highlighting: the legacy
 * `PreviewWorkflow`, painting blocks, containers and edges exactly as the legacy preview does.
 * It mounts its own React Flow provider and the legacy canvas document, so it can sit anywhere.
 */
export function WorkflowPreview({ workspaceId, ...props }: WorkflowPreviewProps) {
  return (
    <PreviewScope workspaceId={workspaceId}>
      <CanvasTokenScope>
        {(colorMode) => <WorkflowPreviewContent {...props} colorMode={colorMode} />}
      </CanvasTokenScope>
    </PreviewScope>
  )
}

interface WorkflowPreviewContentProps extends Omit<WorkflowPreviewProps, 'workspaceId'> {
  colorMode: CanvasColorMode
}

function WorkflowPreviewContent({
  workflowState,
  height = '100%',
  width = '100%',
  isPannable = true,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  onNodeClick,
  onPaneClick,
  cursorStyle = 'grab',
  executedBlocks,
  selectedBlockId,
  lightweight = false,
  blockDiffStatus,
  edgeDiffStatus,
  changedFieldsByBlock,
  removedPortsByBlock,
  colorMode,
}: WorkflowPreviewContentProps) {
  const { workspaceId } = useWorkflowScope()
  const {
    data: workflowMap = {},
    isSuccess: isWorkflowMapLoaded,
    isPlaceholderData: isWorkflowMapPlaceholderData,
  } = useWorkflowMap(workspaceId)
  // Ready only on a successful, non-placeholder load — an errored or stale
  // placeholder map must not mislabel valid workflows as deleted.
  const workflowLabelsReady = isWorkflowMapLoaded && !isWorkflowMapPlaceholderData
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeTypes = previewNodeTypes
  const isValidWorkflowState = workflowState?.blocks && workflowState.edges

  const blocksStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.blocks || {}).length,
      ids: Object.keys(workflowState.blocks || {}).join(','),
    }
  }, [workflowState.blocks, isValidWorkflowState])

  const loopsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.loops || {}).length,
      ids: Object.keys(workflowState.loops || {}).join(','),
    }
  }, [workflowState.loops, isValidWorkflowState])

  const parallelsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.parallels || {}).length,
      ids: Object.keys(workflowState.parallels || {}).join(','),
    }
  }, [workflowState.parallels, isValidWorkflowState])

  /** Map of subflow ID to child block IDs */
  const subflowChildrenMap = useMemo(() => {
    if (!isValidWorkflowState) return new Map<string, string[]>()

    const map = new Map<string, string[]>()
    for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
      const parentId = block?.data?.parentId
      if (parentId) {
        const children = map.get(parentId) || []
        children.push(blockId)
        map.set(parentId, children)
      }
    }
    return map
  }, [workflowState.blocks, isValidWorkflowState])

  /** Maps base block IDs to execution data, handling parallel iteration variants (blockId₍n₎). */
  const blockExecutionMap = useMemo(() => {
    if (!executedBlocks) return new Map<string, { status: string; output?: unknown }>()

    const map = new Map<string, { status: string; output?: unknown }>()
    for (const [key, value] of Object.entries(executedBlocks)) {
      // Extract base ID (remove iteration suffix like ₍0₎)
      const baseId = key.includes('₍') ? key.split('₍')[0] : key
      // Keep first match or error status (error takes precedence)
      const existing = map.get(baseId)
      if (!existing || value.status === 'error') {
        map.set(baseId, value)
      }
    }
    return map
  }, [executedBlocks])

  /** Derives subflow status from children. Recursively checks nested subflows. Error takes precedence. */
  const getSubflowExecutionStatus = useMemo(() => {
    const derive = (
      subflowId: string,
      visited: Set<string> = new Set()
    ): ExecutionStatus | undefined => {
      if (visited.has(subflowId)) return undefined
      visited.add(subflowId)

      const childIds = subflowChildrenMap.get(subflowId)
      if (!childIds?.length) return undefined

      const childStatuses: string[] = []
      for (const childId of childIds) {
        const direct = blockExecutionMap.get(childId)
        if (direct) {
          childStatuses.push(direct.status)
        } else {
          const childBlock = workflowState.blocks?.[childId]
          if (childBlock?.type === 'loop' || childBlock?.type === 'parallel') {
            const nested = derive(childId, visited)
            if (nested) childStatuses.push(nested)
          }
        }
      }

      if (childStatuses.length === 0) return undefined
      if (childStatuses.some((s) => s === 'error')) return 'error'
      if (childStatuses.every((s) => s === 'success')) return 'success'
      return undefined
    }
    return derive
  }, [subflowChildrenMap, blockExecutionMap, workflowState.blocks])

  /** Gets block status. Subflows derive status from children. */
  const getBlockExecutionStatus = useMemo(() => {
    return (blockId: string): { status: string; executed: boolean } | undefined => {
      const directStatus = blockExecutionMap.get(blockId)
      if (directStatus) {
        return { status: directStatus.status, executed: true }
      }

      const block = workflowState.blocks?.[blockId]
      if (block?.type === 'loop' || block?.type === 'parallel') {
        const subflowStatus = getSubflowExecutionStatus(blockId)
        if (subflowStatus) {
          return { status: subflowStatus, executed: true }
        }
      }

      return undefined
    }
  }, [workflowState.blocks, getSubflowExecutionStatus, blockExecutionMap])

  const edgesStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: workflowState.edges?.length || 0,
      ids: workflowState.edges?.map((e) => e.id).join(',') || '',
    }
  }, [workflowState.edges, isValidWorkflowState])

  /**
   * Blocks that already route failures somewhere, as a content key.
   *
   * Such a block keeps its error port whatever its own flag says — React Flow
   * drops an edge whose handle never mounts. A string rather than a Set so a
   * re-received edges array with the same content does not rebuild every node.
   * The raw handle is safe to test: `normalizeWorkflowEdgeHandles` only rewrites
   * the side-anchored source ids, never `error`.
   */
  const errorSourceBlockKey = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of workflowState.edges ?? []) {
      if (
        edge.sourceHandle === 'error' &&
        (edgeDiffStatus?.[edge.id] !== 'removed' || blockDiffStatus?.[edge.source] === 'removed')
      )
        ids.add(edge.source)
    }
    return [...ids].sort().join(',')
  }, [workflowState.edges, edgeDiffStatus, blockDiffStatus])

  const nodes: Node[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    const nodeArray: Node[] = []
    const blocksWithErrorEdge = new Set(errorSourceBlockKey ? errorSourceBlockKey.split(',') : [])

    Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn('Skipping invalid block', { blockId })
        return
      }

      const parentId = block.data?.parentId
      const nestingDepth = calculateNestingDepth(block, workflowState.blocks)

      if (block.type === 'loop' || block.type === 'parallel') {
        const isSelected = selectedBlockId === blockId
        const dimensions = getPreviewBlockDimensions(
          block,
          workflowState.blocks,
          removedPortsByBlock
        )

        // Check for direct error on the subflow block itself (e.g., loop resolution errors)
        // before falling back to children-derived status
        const blockExecution = blockExecutionMap.get(blockId)
        const subflowExecutionStatus: ExecutionStatus | undefined =
          blockExecution?.status === 'error'
            ? 'error'
            : (getSubflowExecutionStatus(blockId) ??
              (blockExecution ? (blockExecution.status as ExecutionStatus) : undefined))

        nodeArray.push({
          id: blockId,
          type: 'subflowNode',
          position: block.position,
          parentId,
          className: parentId ? SUBFLOW_CHILD_NODE_CLASS : undefined,
          extent: block.data?.extent || undefined,
          draggable: false,
          zIndex: nestingDepth,
          data: {
            ...block.data,
            name: block.name,
            width: dimensions.width,
            height: dimensions.height,
            kind: block.type as 'loop' | 'parallel',
            enabled: block.enabled ?? true,
            isPreviewSelected: isSelected,
            executionStatus: subflowExecutionStatus,
            diffStatus: blockDiffStatus?.[blockId],
            removedPorts: removedPortsByBlock?.[blockId],
            lightweight,
          },
        })
        return
      }

      const isSelected = selectedBlockId === blockId

      let executionStatus: ExecutionStatus | undefined
      if (executedBlocks) {
        const blockExecution = executedBlocks[blockId]
        if (blockExecution) {
          if (blockExecution.status === 'error') {
            executionStatus = 'error'
          } else if (blockExecution.status === 'success') {
            executionStatus = 'success'
          } else {
            executionStatus = 'not-executed'
          }
        } else {
          executionStatus = 'not-executed'
        }
      }

      const nodeType = block.type === 'note' ? 'noteBlock' : 'workflowBlock'

      nodeArray.push({
        id: blockId,
        type: nodeType,
        position: block.position,
        parentId,
        className: parentId ? SUBFLOW_CHILD_NODE_CLASS : undefined,
        extent: block.data?.extent || undefined,
        draggable: false,
        zIndex: parentId ? CONTAINER_CHILD_Z_BASE : BLOCK_Z_BASE,
        data: {
          type: block.type,
          name: block.name,
          workflowMap,
          workflowLabelsReady,
          isTrigger: block.triggerMode === true,
          horizontalHandles: block.horizontalHandles ?? false,
          enabled: block.enabled ?? true,
          isPreviewSelected: isSelected,
          executionStatus,
          subBlockValues: block.subBlocks,
          errorEnabled: block.errorEnabled === true,
          hasErrorConnection: blocksWithErrorEdge.has(blockId),
          lightweight,
          diffStatus: blockDiffStatus?.[blockId],
          changedFields: changedFieldsByBlock?.[blockId],
          removedPorts: removedPortsByBlock?.[blockId],
        },
      })
    })

    return sortNodesParentsFirst(nodeArray)
  }, [
    blocksStructure,
    loopsStructure,
    parallelsStructure,
    workflowState.blocks,
    isValidWorkflowState,
    executedBlocks,
    selectedBlockId,
    getSubflowExecutionStatus,
    workflowMap,
    workflowLabelsReady,
    errorSourceBlockKey,
    lightweight,
    blockDiffStatus,
    changedFieldsByBlock,
    removedPortsByBlock,
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    const getEdgeExecutionStatus = (edge: {
      source: string
      target: string
      sourceHandle?: string | null
    }): ExecutionStatus | undefined => {
      if (blockExecutionMap.size === 0) return undefined

      const targetStatus = getBlockExecutionStatus(edge.target)
      if (!targetStatus?.executed) return 'not-executed'

      const sourceStatus = getBlockExecutionStatus(edge.source)
      if (!sourceStatus?.executed) return 'not-executed'

      const handle = edge.sourceHandle
      if (!handle) {
        return sourceStatus.status === 'success' ? 'success' : 'not-executed'
      }

      const sourceOutput = blockExecutionMap.get(edge.source)?.output as
        | Record<string, unknown>
        | undefined

      if (handle.startsWith('condition-')) {
        const conditionValue = handle.substring('condition-'.length)
        return sourceOutput?.selectedOption === conditionValue ? 'success' : 'not-executed'
      }

      if (handle.startsWith('router-')) {
        const routeId = handle.substring('router-'.length)
        return sourceOutput?.selectedRoute === routeId ? 'success' : 'not-executed'
      }

      switch (handle) {
        case 'error':
          return sourceStatus.status === 'error' ? 'error' : 'not-executed'
        case 'source':
          return sourceStatus.status === 'success' ? 'success' : 'not-executed'
        case 'loop-start-source':
        case 'loop-end-source':
        case 'parallel-start-source':
        case 'parallel-end-source':
          return 'success'
        default:
          return sourceStatus.status === 'success' ? 'success' : 'not-executed'
      }
    }

    /*
     * Deployment versions and run snapshots are raw jsonb blobs that never
     * pass through `loadWorkflowFromNormalizedTables`, so unlike the editor
     * canvas their handles arrive un-canonicalized. React Flow drops an edge
     * whose handle matches no mounted handle, so without this the preview
     * renders the cards with no lines between them.
     */
    /*
     * Ghosts go first: edges sharing a z-index paint in array order, and a
     * Loop/Parallel target gives its live and removed edges the same one, so
     * order is what keeps a ghost under the live line into that container.
     */
    const ordered = normalizeWorkflowEdgeHandles(workflowState.edges)
    const edgesInPaintOrder = [
      ...ordered.filter((edge) => edgeDiffStatus?.[edge.id] === 'removed'),
      ...ordered.filter((edge) => edgeDiffStatus?.[edge.id] !== 'removed'),
    ]
    return edgesInPaintOrder.map((edge) => {
      const status = getEdgeExecutionStatus(edge)
      const isErrorEdge = edge.sourceHandle === 'error'
      const isGhost = edgeDiffStatus?.[edge.id] === 'removed'
      /* A ghost sits under every live line so a rewired port shows the new edge on top. */
      const baseZIndex = isGhost
        ? EDGE_Z_BASE - 1
        : status === 'success'
          ? EDGE_Z_MAX
          : isErrorEdge
            ? EDGE_Z_BASE + 2
            : EDGE_Z_BASE
      const targetBlock = workflowState.blocks[edge.target]
      const targetContainerZIndex =
        targetBlock?.type === 'loop' || targetBlock?.type === 'parallel'
          ? calculateNestingDepth(targetBlock, workflowState.blocks)
          : undefined

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        data: {
          ...(status ? { executionStatus: status } : {}),
          ...(edgeDiffStatus?.[edge.id] ? { diffStatus: edgeDiffStatus[edge.id] } : {}),
          sourceHandle: edge.sourceHandle,
        },
        /* Inside the shared edge band, so a line clears the opaque container it
           crosses and still passes behind cards. Execution status orders edges
           within the band: a successful path draws over an error one, which
           draws over an unexecuted one. A Loop/Parallel target overrides that
           ordering so its node paints over the incoming segment. */
        zIndex: getEdgeZIndexForTarget(baseZIndex, targetContainerZIndex),
      }
    })
  }, [
    edgesStructure,
    workflowState.blocks,
    workflowState.edges,
    isValidWorkflowState,
    blockExecutionMap,
    getBlockExecutionStatus,
    edgeDiffStatus,
  ])

  if (!isValidWorkflowState) {
    return (
      <div style={{ height, width }} className={styles.fallback}>
        <div className={styles.fallbackText}>
          <div className={styles.fallbackTitle}>⚠️ Logged State Not Found</div>
          <div className={styles.fallbackBody}>
            This log was migrated from the old system and doesn't contain workflow state data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div
        ref={containerRef}
        style={{ height, width }}
        className={cn(
          styles.root,
          CURSOR_CLASS[cursorStyle],
          onNodeClick && styles.interactiveNodes
        )}
      >
        <ReactFlow
          colorMode={colorMode}
          zIndexMode={CANVAS_Z_INDEX_MODE}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          fitViewOptions={{ padding: fitPadding }}
          panOnScroll={isPannable}
          panOnDrag={isPannable}
          zoomOnScroll={false}
          draggable={false}
          defaultViewport={{
            x: 0,
            y: 0,
            zoom: defaultZoom ?? 1,
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          elementsSelectable={false}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={
            onNodeClick
              ? (event, node) => {
                  logger.debug('Node clicked', { nodeId: node.id, event })
                  onNodeClick(node.id, { x: event.clientX, y: event.clientY })
                }
              : undefined
          }
          onPaneClick={onPaneClick}
          className={styles.flow}
        />
        <FitViewOnChange
          nodeIds={blocksStructure.ids}
          fitPadding={fitPadding}
          containerRef={containerRef}
        />
      </div>
    </ReactFlowProvider>
  )
}
