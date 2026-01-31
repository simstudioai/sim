import { memo, useMemo, useRef } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position, useReactFlow } from 'reactflow'
import { Badge } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { usePanelEditorStore } from '@/stores/panel'

/**
 * Global styles for subflow nodes (loop and parallel containers).
 * Includes animations for drag-over states and hover effects.
 *
 * @returns Style component with global CSS
 */
const SubflowNodeStyles: React.FC = () => {
  return (
    <style jsx global>{`
      /* Z-index management for subflow nodes - default behind blocks */
      .workflow-container .react-flow__node-subflowNode {
        z-index: -1 !important;
      }

      /* Selected subflows appear above other subflows but below blocks (z-21) */
      .workflow-container .react-flow__node-subflowNode:has([data-subflow-selected='true']) {
        z-index: 10 !important;
      }

      /* Drag-over states */
      .loop-node-drag-over,
      .parallel-node-drag-over {
        box-shadow: 0 0 0 1.75px var(--brand-secondary) !important;
        border-radius: 8px !important;
      }

      /* Handle z-index for nested nodes */
      .react-flow__node[data-parent-node-id] .react-flow__handle {
        z-index: 30;
      }
    `}</style>
  )
}

/**
 * Data structure for subflow nodes (loop and parallel containers)
 */
export interface SubflowNodeData {
  width?: number
  height?: number
  parentId?: string
  extent?: 'parent'
  isPreview?: boolean
  /** Whether this subflow is selected in preview mode */
  isPreviewSelected?: boolean
  kind: 'loop' | 'parallel'
  name?: string
}

/**
 * Subflow node component for loop and parallel execution containers.
 * Renders a resizable container with a header displaying the block name and icon,
 * handles for connections, and supports nested execution contexts.
 *
 * @param props - Node properties containing data and id
 * @returns Rendered subflow node component
 */
export const SubflowNodeComponent = memo(({ data, id, selected }: NodeProps<SubflowNodeData>) => {
  const { getNodes } = useReactFlow()
  const blockRef = useRef<HTMLDivElement>(null)
  const userPermissions = useUserPermissionsContext()

  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)
  const diffStatus: DiffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  const isEnabled = currentBlock?.enabled ?? true
  const isLocked = currentBlock?.locked ?? false
  const isPreview = data?.isPreview || false

  // Focus state
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isFocused = currentBlockId === id

  const isPreviewSelected = data?.isPreviewSelected || false

  /**
   * Calculate the nesting level of this subflow node based on its parent hierarchy.
   * Used to apply appropriate styling for nested containers.
   */
  const nestingLevel = useMemo(() => {
    let level = 0
    let currentParentId = data?.parentId

    while (currentParentId) {
      level++
      const parentNode = getNodes().find((n) => n.id === currentParentId)
      if (!parentNode) break
      currentParentId = parentNode.data?.parentId
    }

    return level
  }, [id, data?.parentId, getNodes])

  const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
  const BlockIcon = data.kind === 'loop' ? RepeatIcon : SplitIcon
  const blockIconBg = data.kind === 'loop' ? '#2FB3FF' : '#FEE12B'
  const blockName = data.name || (data.kind === 'loop' ? 'Loop' : 'Parallel')

  /**
   * Reusable styles and positioning for Handle components.
   * Matches the styling pattern from workflow-block.tsx.
   */
  const getHandleClasses = (position: 'left' | 'right') => {
    const baseClasses = '!z-[10] !cursor-crosshair !border-none !transition-[colors] !duration-150'
    const colorClasses = '!bg-[var(--workflow-edge)]'

    const positionClasses = {
      left: '!left-[-8px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover:!left-[-11px] hover:!w-[10px] hover:!rounded-l-full',
      right:
        '!right-[-8px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover:!right-[-11px] hover:!w-[10px] hover:!rounded-r-full',
    }

    return cn(baseClasses, colorClasses, positionClasses[position])
  }

  const getHandleStyle = () => {
    return { top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`, transform: 'translateY(-50%)' }
  }

  /**
   * Determine the ring styling based on subflow state priority:
   * 1. Focused (selected in editor), selected (shift-click/box), or preview selected - blue ring
   * 2. Diff status (version comparison) - green/orange ring
   */
  const isSelected = !isPreview && selected
  const hasRing =
    isFocused || isSelected || isPreviewSelected || diffStatus === 'new' || diffStatus === 'edited'
  const ringStyles = cn(
    hasRing && 'ring-[1.75px]',
    (isFocused || isSelected || isPreviewSelected) && 'ring-[var(--brand-secondary)]',
    diffStatus === 'new' && 'ring-[var(--brand-tertiary-2)]',
    diffStatus === 'edited' && 'ring-[var(--warning)]'
  )

  return (
    <>
      <SubflowNodeStyles />
      <div className='group relative'>
        <div
          ref={blockRef}
          onClick={() => setCurrentBlockId(id)}
          className={cn(
            'workflow-drag-handle relative cursor-grab select-none rounded-[8px] border border-[var(--border-1)] [&:active]:cursor-grabbing',
            'transition-block-bg transition-ring',
            'z-[20]'
          )}
          style={{
            width: data.width || 500,
            height: data.height || 300,
            position: 'relative',
            overflow: 'visible',
            pointerEvents: isPreview ? 'none' : 'all',
          }}
          data-node-id={id}
          data-type='subflowNode'
          data-nesting-level={nestingLevel}
          data-subflow-selected={isFocused || isSelected || isPreviewSelected}
        >
          {!isPreview && (
            <ActionBar blockId={id} blockType={data.kind} disabled={!userPermissions.canEdit} />
          )}

          {/* Header Section */}
          <div
            className={cn(
              'flex items-center justify-between rounded-t-[8px] border-[var(--border)] border-b bg-[var(--surface-2)] py-[8px] pr-[12px] pl-[8px]'
            )}
          >
            <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
              <div
                className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
                style={{ backgroundColor: isEnabled ? blockIconBg : 'gray' }}
              >
                <BlockIcon className='h-[16px] w-[16px] text-white' />
              </div>
              <span
                className={cn(
                  'truncate font-medium text-[16px]',
                  !isEnabled && 'text-[var(--text-muted)]'
                )}
                title={blockName}
              >
                {blockName}
              </span>
            </div>
            <div className='flex items-center gap-1'>
              {!isEnabled && <Badge variant='gray-secondary'>disabled</Badge>}
              {isLocked && <Badge variant='gray-secondary'>locked</Badge>}
            </div>
          </div>

          {!isPreview && (
            <div
              className='absolute right-[8px] bottom-[8px] z-20 flex h-[32px] w-[32px] cursor-se-resize items-center justify-center text-muted-foreground'
              style={{ pointerEvents: 'auto' }}
            />
          )}

          <div
            className='h-[calc(100%-50px)] pt-[16px] pr-[80px] pb-[16px] pl-[16px]'
            data-dragarea='true'
            style={{
              position: 'relative',
              pointerEvents: isPreview ? 'none' : 'auto',
            }}
          >
            {/* Subflow Start */}
            <div
              className='absolute top-[16px] left-[16px] flex items-center justify-center rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] px-[12px] py-[6px]'
              style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
              data-parent-id={id}
              data-node-role={`${data.kind}-start`}
              data-extent='parent'
            >
              <span className='font-medium text-[14px] text-[var(--text-primary)]'>Start</span>

              <Handle
                type='source'
                position={Position.Right}
                id={startHandleId}
                className={getHandleClasses('right')}
                style={{
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'auto',
                }}
                data-parent-id={id}
              />
            </div>
          </div>

          {/* Input handle on left middle */}
          <Handle
            type='target'
            position={Position.Left}
            className={getHandleClasses('left')}
            style={{
              ...getHandleStyle(),
              pointerEvents: 'auto',
            }}
          />

          {/* Output handle on right middle */}
          <Handle
            type='source'
            position={Position.Right}
            className={getHandleClasses('right')}
            style={{
              ...getHandleStyle(),
              pointerEvents: 'auto',
            }}
            id={endHandleId}
          />

          {hasRing && (
            <div
              className={cn('pointer-events-none absolute inset-0 z-40 rounded-[8px]', ringStyles)}
            />
          )}
        </div>
      </div>
    </>
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
