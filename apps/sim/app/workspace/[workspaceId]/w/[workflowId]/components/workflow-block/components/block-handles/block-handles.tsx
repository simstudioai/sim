import { Handle, Position } from 'reactflow'
import { cn } from '@/lib/utils'

interface BlockHandlesProps {
  blockId: string
  blockType: string
  blockCategory: string
  horizontalHandles: boolean
  displayTriggerMode: boolean
}

/**
 * Component for rendering block connection handles (input, output, error)
 */
export function BlockHandles({
  blockId,
  blockType,
  blockCategory,
  horizontalHandles,
  displayTriggerMode,
}: BlockHandlesProps) {
  const isStarterBlock = blockType === 'starter'
  const isTriggerBlock = blockCategory === 'triggers'
  const isConditionBlock = blockType === 'condition'
  const isResponseBlock = blockType === 'response'

  const shouldShowInputHandle = !isTriggerBlock && !isStarterBlock && !displayTriggerMode

  const shouldShowOutputHandle = !isConditionBlock && !isResponseBlock

  const shouldShowErrorHandle = !isTriggerBlock && !isStarterBlock && !displayTriggerMode

  return (
    <>
      {/* Input Handle */}
      {shouldShowInputHandle && (
        <Handle
          type='target'
          position={horizontalHandles ? Position.Left : Position.Top}
          id='target'
          className={cn(
            horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
            '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
            '!z-[30]',
            'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
            horizontalHandles
              ? 'hover:!w-[10px] hover:!left-[-10px] hover:!rounded-l-full hover:!rounded-r-none'
              : 'hover:!h-[10px] hover:!top-[-10px] hover:!rounded-t-full hover:!rounded-b-none',
            '!cursor-crosshair',
            'transition-[colors] duration-150',
            horizontalHandles ? '!left-[-7px]' : '!top-[-7px]'
          )}
          style={{
            ...(horizontalHandles
              ? { top: '50%', transform: 'translateY(-50%)' }
              : { left: '50%', transform: 'translateX(-50%)' }),
          }}
          data-nodeid={blockId}
          data-handleid='target'
          isConnectableStart={false}
          isConnectableEnd={true}
          isValidConnection={(connection) => connection.source !== blockId}
        />
      )}

      {/* Output Handle */}
      {shouldShowOutputHandle && (
        <Handle
          type='source'
          position={horizontalHandles ? Position.Right : Position.Bottom}
          id='source'
          className={cn(
            horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
            '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
            '!z-[30]',
            'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
            horizontalHandles
              ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
              : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
            '!cursor-crosshair',
            'transition-[colors] duration-150',
            horizontalHandles ? '!right-[-7px]' : '!bottom-[-7px]'
          )}
          style={{
            ...(horizontalHandles
              ? { top: '50%', transform: 'translateY(-50%)' }
              : { left: '50%', transform: 'translateX(-50%)' }),
          }}
          data-nodeid={blockId}
          data-handleid='source'
          isConnectableStart={true}
          isConnectableEnd={false}
          isValidConnection={(connection) => connection.target !== blockId}
        />
      )}

      {/* Error Handle */}
      {shouldShowOutputHandle && shouldShowErrorHandle && (
        <Handle
          type='source'
          position={horizontalHandles ? Position.Right : Position.Bottom}
          id='error'
          className={cn(
            horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
            '!bg-red-400 dark:!bg-red-500 !rounded-[2px] !border-none',
            '!z-[30]',
            'group-hover:!shadow-[0_0_0_3px_rgba(248,113,113,0.15)]',
            horizontalHandles
              ? 'hover:!w-[10px] hover:!right-[-10px] hover:!rounded-r-full hover:!rounded-l-none'
              : 'hover:!h-[10px] hover:!bottom-[-10px] hover:!rounded-b-full hover:!rounded-t-none',
            '!cursor-crosshair',
            'transition-[colors] duration-150'
          )}
          style={{
            position: 'absolute',
            ...(horizontalHandles
              ? {
                  right: '-8px',
                  top: 'auto',
                  bottom: '30px',
                  transform: 'translateY(0)',
                }
              : {
                  bottom: '-7px',
                  left: 'auto',
                  right: '30px',
                  transform: 'translateX(0)',
                }),
          }}
          data-nodeid={blockId}
          data-handleid='error'
          isConnectableStart={true}
          isConnectableEnd={false}
          isValidConnection={(connection) => connection.target !== blockId}
        />
      )}
    </>
  )
}
