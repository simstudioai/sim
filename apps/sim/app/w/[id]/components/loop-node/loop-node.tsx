import { memo, useMemo, useRef } from 'react'
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow'
import { Trash2 } from 'lucide-react'
import { StartIcon } from '@/components/icons'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { LoopConfigBadges } from './components/loop-config-badges'


export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { getNodes } = useReactFlow();
  const blockRef = useRef<HTMLDivElement>(null);
  
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
  
  // Generate different background styles based on nesting level
  const getNestedStyles = () => {
    // Base styles
    const styles: Record<string, string> = {
      backgroundColor: data?.state === 'valid' ? 'rgba(34,197,94,0.05)' : 'transparent',
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
    <div className="relative group">
      <Card
        ref={blockRef}
        className={cn(
          ' select-none relative cursor-default',
          'transition-ring transition-block-bg',
          'z-[20]',
          data?.state === 'valid' && 'ring-2 ring-[#2FB3FF] bg-[rgba(34,197,94,0.05)]',
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
        data-type="loopNode"
        data-nesting-level={nestingLevel}
      >
        {/* Critical drag handle that controls only the loop node movement */}
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

          {/* Loop Start Block */}
          <div 
            className="absolute top-1/2 left-8 w-10 bg-[#2FB3FF] rounded-md p-2 h-10 flex items-center justify-center transform -translate-y-1/2"
            style={{ pointerEvents: 'auto' }}
            data-parent-id={id} 
            data-node-role="loop-start"
            data-extent="parent"
          >
            <StartIcon className="text-white w-6 h-6" />
            
            <Handle
              type="source"
              position={Position.Right}
              id="loop-start-source"
              className="!w-[6px] !h-4 !bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none !z-[30] hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none !cursor-crosshair -[colors] duration-150"
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
          id="loop-end-source"
        />

        {/* Loop Configuration Badges */}
        <LoopConfigBadges nodeId={id} data={data} />
      </Card>
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 