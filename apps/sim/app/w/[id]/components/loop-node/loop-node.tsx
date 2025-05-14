import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { X, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { useGeneralStore } from '@/stores/settings/general/store'
import { LoopConfigBadges } from './components/loop-config-badges'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  // const { getNodes, setNodes, screenToFlowPosition } = useReactFlow()
  const { updateNodeDimensions } = useWorkflowStore()

  // // Handle resize with boundaries
  const handleResize = useCallback((evt: any, params: { width: number; height: number }) => {
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 1000

    const finalWidth = Math.max(params.width, minWidth)
    const finalHeight = Math.max(params.height, minHeight)

    // Update node dimensions
    updateNodeDimensions(id, { width: finalWidth, height: finalHeight })
  }, [id, updateNodeDimensions])

  return (
    <div 
      className={cn(
        'relative group-node',
        data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]',
      )}
      style={{
        width: data.width || 800,
        height: data.height || 1000,
        borderRadius: '8px',
        position: 'relative',
        overflow: 'visible',
        border: data?.state === 'valid' ? '2px solid #40E0D0' : '2px dashed #94a3b8',
        backgroundColor: data?.state === 'valid' ? 'rgba(34,197,94,0.05)' : 'transparent',
        transition: 'width 0.2s ease-out, height 0.2s ease-out, border-color 0.2s ease-in-out, background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        try {
          // Check for toolbar items
          if (e.dataTransfer?.types.includes('application/json')) {
            const rawData = e.dataTransfer.getData('application/json');
            if (rawData) {
              const data = JSON.parse(rawData);
              const type = data.type || (data.data && data.data.type);
            }
          }

          // If we get here, no valid drag is happening
        } catch (err) {
          logger.error('Error checking dataTransfer:', err);
        }
      }}
      data-node-id={id}
      data-type="loopNode"
    >
      {/* Critical drag handle that controls only the loop node movement */}
      <div 
        className="absolute top-0 left-0 right-0 h-10 workflow-drag-handle cursor-move z-10"
      />

      {/* Custom visible resize handle */}
      <div 
        className="absolute bottom-2 right-2 w-8 h-8 flex items-center justify-center z-20 text-muted-foreground cursor-se-resize"
      >
      </div>

      {/* Child nodes container */}
      <div 
        className="p-4 h-[calc(100%-10px)]" 
        data-dragarea="true"
        style={{
          position: 'relative',
          minHeight: '100%',
        }}
      >
        {/* Delete button - now always visible */}
        <div 
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-background/90 hover:bg-red-100 border border-border cursor-pointer z-20 shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            useWorkflowStore.getState().removeBlock(id);
          }}
        >
          <X size={14} className="text-muted-foreground hover:text-red-500" />
        </div>

        {/* Loop Start Block - positioned at left middle */}
        <div className="absolute top-1/2 left-10 w-28 transform -translate-y-1/2">
          <div className="bg-[#40E0D0]/20 border border-[#40E0D0]/50 rounded-md p-2 relative hover:bg-[#40E0D0]/30 transition-colors">
            <div className="flex items-center justify-center gap-1.5">
              <PlayCircle size={16} className="text-[#40E0D0]" />
            </div>

            <div>
              <Handle
                type="source"
                position={Position.Right}
                id="loop-start-source"
                className="!bg-[#40E0D0] !w-3 !h-3 z-40"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Input handle on left middle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-400 !w-3 !h-3"
        style={{ 
          left: "-6px", 
          top: "50%",
          transform: "translateY(-50%)" 
        }}
      />

      {/* Output handle on right middle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-400 !w-3 !h-3"
        style={{ 
          right: "-6px", 
          top: "50%",
          transform: "translateY(-50%)" 
        }}
        id="loop-end-source"
      />

      {/* Loop Configuration Badges */}
      <LoopConfigBadges nodeId={id} data={data} />
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 