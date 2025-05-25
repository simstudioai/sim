import { memo, useMemo, useRef } from 'react'
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow'
import { Trash2 } from 'lucide-react'
import { StartIcon } from '@/components/icons'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ParallelBadges } from './components/parallel-badges'
import React from 'react'

// Add these styles to your existing global CSS file or create a separate CSS module
const ParallelNodeStyles: React.FC = () => {
  return (
    <style jsx global>{`
      @keyframes parallel-node-pulse {
        0% { box-shadow: 0 0 0 0 rgba(254, 225, 43, 0.3); }
        70% { box-shadow: 0 0 0 6px rgba(254, 225, 43, 0); }
        100% { box-shadow: 0 0 0 0 rgba(254, 225, 43, 0); }
      }
      
      .parallel-node-drag-over {
        animation: parallel-node-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        border-style: solid !important;
        background-color: rgba(254, 225, 43, 0.08) !important;
        box-shadow: 0 0 0 8px rgba(254, 225, 43, 0.1);
      }
      
      /* Make resizer handles more visible */
      .react-flow__resize-control {
        z-index: 10;
        pointer-events: all !important;
      }
      
      /* Ensure parent borders are visible when hovering over resize controls */
      .react-flow__node-group:hover,
      .hover-highlight {
        border-color: #1e293b !important;
      }
      
      /* Ensure hover effects work well */
      .group-node-container:hover .react-flow__resize-control.bottom-right {
        opacity: 1 !important;
        visibility: visible !important;
      }
      
      /* React Flow position transitions within parallel blocks */
      .react-flow__node[data-parent-node-id] {
        transition: transform 0.05s ease;
        pointer-events: all;
      }
      
      /* Prevent jumpy drag behavior */
      .parallel-drop-container .react-flow__node {
        transform-origin: center;
        position: absolute;
      }
      
      /* Remove default border from React Flow group nodes */
      .react-flow__node-group {
        border: none;
        background-color: transparent;
        outline: none;
        box-shadow: none;
      }
      
      /* Ensure child nodes stay within parent bounds */
      .react-flow__node[data-parent-node-id] .react-flow__handle {
        z-index: 30;
      }
      
      /* Enhanced drag detection */
      .react-flow__node-group.dragging-over {
        background-color: rgba(254,225,43,0.05);
        transition: all 0.2s ease-in-out;
      }
    `}</style>
  )
}

export const ParallelNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { getNodes } = useReactFlow();
  const blockRef = useRef<HTMLDivElement>(null);
  
  // Determine nesting level by ing parents
  const nestingLevel = useMemo(() => {
    let level = 0;
    let currentParentId = data?.parentId;
    
    while (currentParentId) {
      level++;
      const parentNode = getNodes().find(n => n.id === currentParentId);
      if (!parentNode) break;
      currentParentId = parentNode.data?.parentId;
    }
    
    return level;
  }, [id, data?.parentId, getNodes]);
  
  // Generate different background styles based on nesting level
  const getNestedStyles = () => {
    // Base styles
    const styles: Record<string, string> = {
      backgroundColor: data?.state === 'valid' ? 'rgba(254, 225, 43, 0.05)' : 'transparent',
    };
    
    // Apply nested styles
    if (nestingLevel > 0) {
      // Each nesting level gets a different color
      const colors = ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569'];
      const colorIndex = (nestingLevel - 1) % colors.length;
      
      styles.backgroundColor = `${colors[colorIndex]}30`; // Slightly more visible background
    }
    
    return styles;
  };
  
  const nestedStyles = getNestedStyles();

  return (
    <>
      <ParallelNodeStyles />
      <div className="relative group">
        <Card
          ref={blockRef}
          className={cn(
            'select-none relative cursor-default',
            'transition-ring transition-block-bg',
            'z-[20]',
            data?.state === 'valid' && 'ring-2 ring-[#FEE12B] bg-[rgba(254,225,43,0.05)]',
            nestingLevel > 0 && `border border-[0.5px] ${nestingLevel % 2 === 0 ? 'border-slate-300/60' : 'border-slate-400/60'}`
          )}
          style={{
            width: data.width || 500,
            height: data.height || 300,
            position: 'relative',
            overflow: 'visible',
            ...nestedStyles,
            pointerEvents: 'all',
          }}
          data-node-id={id}
          data-type="parallelNode"
          data-nesting-level={nestingLevel}
        >
          {/* Critical drag handle that controls only the parallel node movement */}
          <div 
            className="absolute top-0 left-0 right-0 h-10 workflow-drag-handle cursor-move z-10"
            style={{ pointerEvents: 'auto' }}
          />

          {/* Custom visible resize handle */}
          <div 
            className="absolute bottom-2 right-2 w-8 h-8 flex items-center justify-center z-20 text-muted-foreground cursor-se-resize"
            style={{ pointerEvents: 'auto' }}
          >
          </div>

          {/* Child nodes container - Set pointerEvents to allow dragging of children */}
          <div 
            className="p-4 h-[calc(100%-10px)]" 
            data-dragarea="true"
            style={{
              position: 'relative',
              minHeight: '100%',
              pointerEvents: 'auto',
            }}
          >
            {/* Delete button - styled like in action-bar.tsx */}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                useWorkflowStore.getState().removeBlock(id);
              }}
              className="absolute top-2 right-2 z-20 text-gray-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ pointerEvents: 'auto' }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            {/* Parallel Start Block */}
            <div 
              className="absolute top-1/2 left-8 w-10 bg-[#FEE12B] rounded-md p-2 h-10 flex items-center justify-center transform -translate-y-1/2"
              style={{ pointerEvents: 'auto' }}
              data-parent-id={id} 
              data-node-role="parallel-start"
              data-extent="parent"
            >
              <StartIcon className="text-white w-6 h-6" />
              
              <Handle
                type="source"
                position={Position.Right}
                id="parallel-start-source"
                className="!w-[6px] !h-4 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150"
                style={{ 
                  right: "-6px", 
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: 'auto'
                }}
                data-parent-id={id}
              />
            </div>
          </div>

          {/* Input handle on left middle */}
          <Handle
            type="target"
            position={Position.Left}
            className="!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !cursor-crosshair transition-[colors] duration-150"
            style={{ 
              left: "-7px", 
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: 'auto'
            }}
          />

          {/* Output handle on right middle */}
          <Handle
            type="source"
            position={Position.Right}
            className="!w-[7px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150"
            style={{ 
              right: "-7px", 
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: 'auto'
            }}
            id="parallel-end-source"
          />

          {/* Parallel Configuration Badges */}
          <ParallelBadges nodeId={id} data={data} />
        </Card>
      </div>
    </>
  )
})

ParallelNodeComponent.displayName = 'ParallelNodeComponent'
