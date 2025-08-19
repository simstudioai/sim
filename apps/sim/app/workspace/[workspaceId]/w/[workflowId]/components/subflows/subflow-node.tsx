import type React from 'react'
import { memo, useMemo, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Handle, type NodeProps, Position, useReactFlow } from 'reactflow'
import { StartIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { IterationBadges } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/components/iteration-badges/iteration-badges'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

const SubflowNodeStyles: React.FC = () => {
  return (
    <style jsx global>{`
      @keyframes loop-node-pulse {
        0% { box-shadow: 0 0 0 0 rgba(47, 179, 255, 0.3); }
        70% { box-shadow: 0 0 0 6px rgba(47, 179, 255, 0); }
        100% { box-shadow: 0 0 0 0 rgba(47, 179, 255, 0); }
      }

      @keyframes parallel-node-pulse {
        0% { box-shadow: 0 0 0 0 rgba(139, 195, 74, 0.3); }
        70% { box-shadow: 0 0 0 6px rgba(139, 195, 74, 0); }
        100% { box-shadow: 0 0 0 0 rgba(139, 195, 74, 0); }
      }

      .loop-node-drag-over {
        animation: loop-node-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        border-style: solid !important;
        background-color: rgba(47, 179, 255, 0.08) !important;
        box-shadow: 0 0 0 8px rgba(47, 179, 255, 0.1);
      }

      .parallel-node-drag-over {
        animation: parallel-node-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        border-style: solid !important;
        background-color: rgba(139, 195, 74, 0.08) !important;
        box-shadow: 0 0 0 8px rgba(139, 195, 74, 0.1);
      }

      .react-flow__node-group:hover,
      .hover-highlight {
        border-color: #1e293b !important;
      }

      .group-node-container:hover .react-flow__resize-control.bottom-right {
        opacity: 1 !important;
        visibility: visible !important;
      }

      .react-flow__node[data-parent-node-id] .react-flow__handle {
        z-index: 30;
      }

      .react-flow__node-group.dragging-over {
        background-color: rgba(34,197,94,0.05);
        transition: all 0.2s ease-in-out;
      }
    `}</style>
  )
}

export interface SubflowNodeData {
  width?: number
  height?: number
  parentId?: string
  extent?: 'parent'
  hasNestedError?: boolean
  isPreview?: boolean
  kind: 'loop' | 'parallel'
}

export const SubflowNodeComponent = memo(({ data, id }: NodeProps<SubflowNodeData>) => {
  const { getNodes } = useReactFlow()
  const { collaborativeRemoveBlock } = useCollaborativeWorkflow()
  const blockRef = useRef<HTMLDivElement>(null)

  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)
  const diffStatus: DiffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  const isPreview = data?.isPreview || false

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

  const getNestedStyles = () => {
    const styles: Record<string, string> = {
      backgroundColor: 'rgba(0, 0, 0, 0.02)',
    }
    if (nestingLevel > 0) {
      const colors = ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569']
      const colorIndex = (nestingLevel - 1) % colors.length
      styles.backgroundColor = `${colors[colorIndex]}30`
    }
    return styles
  }

  const nestedStyles = getNestedStyles()

  const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
  const startBg = data.kind === 'loop' ? '#2FB3FF' : '#FEE12B'

  return (
    <>
      <SubflowNodeStyles />
      <div className='group relative'>
        <Card
          ref={blockRef}
          className={cn(
            'relative cursor-default select-none',
            'transition-block-bg transition-ring',
            'z-[20]',
            nestingLevel > 0 &&
              `border border-[0.5px] ${nestingLevel % 2 === 0 ? 'border-slate-300/60' : 'border-slate-400/60'}`,
            data?.hasNestedError && 'border-2 border-red-500 bg-red-50/50',
            diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
            diffStatus === 'edited' &&
              'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10'
          )}
          style={{
            width: data.width || 500,
            height: data.height || 300,
            position: 'relative',
            overflow: 'visible',
            ...nestedStyles,
            pointerEvents: isPreview ? 'none' : 'all',
          }}
          data-node-id={id}
          data-type='subflowNode'
          data-nesting-level={nestingLevel}
        >
          {!isPreview && (
            <div
              className='workflow-drag-handle absolute top-0 right-0 left-0 z-10 h-10 cursor-move'
              style={{ pointerEvents: 'auto' }}
            />
          )}

          {!isPreview && (
            <div
              className='absolute right-2 bottom-2 z-20 flex h-8 w-8 cursor-se-resize items-center justify-center text-muted-foreground'
              style={{ pointerEvents: 'auto' }}
            />
          )}

          <div
            className='h-[calc(100%-10px)] p-4'
            data-dragarea='true'
            style={{
              position: 'relative',
              minHeight: '100%',
              pointerEvents: isPreview ? 'none' : 'auto',
            }}
          >
            {!isPreview && (
              <Button
                variant='ghost'
                size='sm'
                onClick={(e) => {
                  e.stopPropagation()
                  collaborativeRemoveBlock(id)
                }}
                className='absolute top-2 right-2 z-20 text-gray-500 opacity-0 transition-opacity duration-200 hover:text-red-600 group-hover:opacity-100'
                style={{ pointerEvents: 'auto' }}
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            )}

            {/* Subflow Start */}
            <div
              className='-translate-y-1/2 absolute top-1/2 left-8 flex h-10 w-10 transform items-center justify-center rounded-md p-2'
              style={{ pointerEvents: isPreview ? 'none' : 'auto', backgroundColor: startBg }}
              data-parent-id={id}
              data-node-role={`${data.kind}-start`}
              data-extent='parent'
            >
              <StartIcon className='h-6 w-6 text-white' />

              <Handle
                type='source'
                position={Position.Right}
                id={startHandleId}
                className='!w-[6px] !h-4 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150'
                style={{
                  right: '-6px',
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
            className='!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !cursor-crosshair transition-[colors] duration-150'
            style={{
              left: '-7px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
            }}
          />

          {/* Output handle on right middle */}
          <Handle
            type='source'
            position={Position.Right}
            className='!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150'
            style={{
              right: '-7px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'auto',
            }}
            id={endHandleId}
          />

          <IterationBadges nodeId={id} data={data} iterationType={data.kind} />
        </Card>
      </div>
    </>
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
