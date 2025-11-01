import { RepeatIcon, SplitIcon } from 'lucide-react'
import {
  type ConnectedBlock,
  useBlockConnections,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/hooks/use-block-connections'
import { getBlock } from '@/blocks'

interface ConnectionBlocksProps {
  blockId: string
  horizontalHandles: boolean
  isDisabled?: boolean
}

/**
 * Displays incoming connections as compact floating text above the workflow block
 */
export function ConnectionBlocks({
  blockId,
  horizontalHandles,
  isDisabled = false,
}: ConnectionBlocksProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const connectionCount = incomingConnections.length

  // For vertical handles, show simplified view on the left
  if (!horizontalHandles) {
    return (
      <div className='-translate-x-full -translate-y-1/2 absolute top-1/2 left-0 pr-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
        <span className='text-[#AEAEAE] text-[14px]'>
          {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}
        </span>
      </div>
    )
  }

  // For horizontal handles, show full view with icons
  const maxVisibleIcons = 5
  const visibleConnections = incomingConnections.slice(0, maxVisibleIcons)
  const remainingCount = connectionCount - maxVisibleIcons

  return (
    <div className='absolute bottom-full left-0 ml-[8px] flex items-center gap-[8px] pb-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
      {/* Connection Count Text */}
      <span className='text-[#AEAEAE] text-[14px]'>
        {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}
      </span>

      {/* Vertical Bar */}
      <div className='h-[14px] w-[1px] bg-[#AEAEAE]' />

      {/* Connection Icons */}
      <div className='flex items-center gap-[4px]'>
        {visibleConnections.map((connection: ConnectedBlock) => {
          const blockConfig = getBlock(connection.type)

          let Icon = blockConfig?.icon

          // Handle special blocks
          if (!blockConfig) {
            if (connection.type === 'loop') {
              Icon = RepeatIcon as typeof Icon
            } else if (connection.type === 'parallel') {
              Icon = SplitIcon as typeof Icon
            }
          }

          if (!Icon) return null

          return <Icon key={connection.id} className='h-[14px] w-[14px] text-[#AEAEAE]' />
        })}
        {remainingCount > 0 && (
          <span className='text-[#AEAEAE] text-[14px]'>+{remainingCount}</span>
        )}
      </div>
    </div>
  )
}
