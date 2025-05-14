import { memo, useMemo } from 'react'
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow'
import { Trash2 } from 'lucide-react'
import { StartIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { LoopConfigBadges } from './components/loop-config-badges'


export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { getNodes } = useReactFlow();
  
  // Determine nesting level by counting parents
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
  
  // Generate different border styles based on nesting level
  const getBorderStyle = () => {
    // Base styles
    const styles = {
      border: '1px solid rgba(148, 163, 184, 0.6)',
      backgroundColor: data?.state === 'valid' ? 'rgba(34,197,94,0.05)' : 'transparent',
    };
    
    // Apply nested styles
    if (nestingLevel > 0) {
      // Each nesting level gets a different color
      const colors = ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569'];
      const colorIndex = (nestingLevel - 1) % colors.length;
      
      styles.border = `2px solid ${colors[colorIndex]}`;
      styles.backgroundColor = `${colors[colorIndex]}30`; // Slightly more visible background
    }
    
    return styles;
  };
  
  const borderStyle = getBorderStyle();

  return (
    <div 
      className={cn(
        'relative group-node group',
        data?.state === 'valid' && 'border-[#2FB3FF] bg-[rgba(34,197,94,0.05)]',
      )}
      style={{
        width: data.width || 800,
        height: data.height || 1000,
        borderRadius: '8px',
        position: 'relative',
        overflow: 'visible',
        ...borderStyle,
        pointerEvents: 'all',
        transition: 'width 0.2s ease-out, height 0.2s ease-out, border-color 0.2s ease-in-out, background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
      }}
      data-node-id={id}
      data-type="loopNode"
      data-nesting-level={nestingLevel}
    >
      {/* Critical drag handle that controls only the loop node movement */}
      <div 
        className="absolute top-0 left-0 right-0 h-10 workflow-drag-handle cursor-move z-10"
        style={{ pointerEvents: 'auto' }}
      />

      {/* Nesting level indicator */}
      {nestingLevel > 0 && (
        <div 
          className="absolute top-2 left-2 px-2 py-0.5 text-xs rounded-md bg-background/80 border border-border shadow-sm z-10"
          style={{ pointerEvents: 'none' }}
        >
          Nested: L{nestingLevel}
        </div>
      )}

      {/* Custom visible resize handle */}
      <div 
        className="absolute bottom-2 right-2 w-8 h-8 flex items-center justify-center z-20 text-muted-foreground cursor-se-resize"
        style={{ pointerEvents: 'auto' }}
      >
      </div>

      {/* Child nodes container - Set pointerEvents: none to allow events to reach edges */}
      <div 
        className="p-4 h-[calc(100%-10px)]" 
        data-dragarea="true"
        style={{
          position: 'relative',
          minHeight: '100%',
          pointerEvents: 'none',
        }}
      >
        {/* Delete button - now always visible */}
        <div 
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-background/90 hover:bg-red-100 border border-border cursor-pointer z-20 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          onClick={(e) => {
            e.stopPropagation();
            useWorkflowStore.getState().removeBlock(id);
          }}
          style={{ pointerEvents: 'auto' }} // Re-enable pointer events for this button
        >
          <Trash2 size={14} className="text-muted-foreground hover:text-red-500" />
        </div>

        {/* Loop Start Block - positioned at left middle */}
        <div 
          className="absolute top-1/2 left-8 w-12 transform -translate-y-1/2"
          style={{ pointerEvents: 'auto' }} // Re-enable pointer events
        >
          <div 
            className="bg-white border border-border rounded-md p-2 h-12 relative hover:bg-slate-50 transition-colors flex items-center justify-center"
            data-parent-id={id}
            data-node-role="loop-start"
            data-extent="parent"
          >
            <div
            className="bg-[#2FB3FF] rounded-full p-1.5 flex items-center justify-center"
            style={{ zIndex: 1}}>
              <StartIcon className="text-white w-6 h-6" />
            </div>

            <Handle
              type="source"
              position={Position.Right}
              id="loop-start-source"
              className="!w-[7px] !h-4 !bg-[#2FB3FF] dark:!bg-[#2FB3FF]! !border-none !z-[30] group-hover:!shadow-[0_0_0_3px_rgba(64,224,208,0.15)] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full !cursor-crosshair transition-[colors] duration-150"
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
      </div>

      {/* Input handle on left middle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-[10px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)] hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none !cursor-crosshair transition-[colors] duration-150"
        style={{ 
          left: "-6px", 
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: 'auto'
        }}
      />

      {/* Output handle on right middle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-[10px] !h-5 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair transition-[colors] duration-150"
        style={{ 
          right: "-6px", 
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: 'auto'
        }}
        id="loop-end-source"
      />

      {/* Loop Configuration Badges */}
      <LoopConfigBadges nodeId={id} data={data} />
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 