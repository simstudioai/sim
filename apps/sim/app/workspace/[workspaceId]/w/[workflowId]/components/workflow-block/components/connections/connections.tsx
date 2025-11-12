import { RepeatIcon, SplitIcon } from 'lucide-react'
import {
  type ConnectedBlock,
  useBlockConnections,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/hooks/use-block-connections'
import { getBlock } from '@/blocks'

interface ConnectionsProps {
  blockId: string
  horizontalHandles: boolean
}

/**
 * Retrieves the icon component for a given connection block
 * @param connection - The connected block to get the icon for
 * @returns The icon component or null if not found
 */
function getConnectionIcon(connection: ConnectedBlock) {
  const blockConfig = getBlock(connection.type)

  if (blockConfig?.icon) {
    return blockConfig.icon
  }

  if (connection.type === 'loop') {
    return RepeatIcon
  }

  if (connection.type === 'parallel') {
    return SplitIcon
  }

  return null
}

/**
 * Displays incoming connections as compact floating text above the workflow block
 */
export function Connections({ blockId, horizontalHandles }: ConnectionsProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const connectionCount = incomingConnections.length
  const maxVisibleIcons = 4
  const visibleConnections = incomingConnections.slice(0, maxVisibleIcons)
  const remainingCount = connectionCount - maxVisibleIcons

  const connectionText = `${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`

  const connectionIcons = (
    <>
      {visibleConnections.map((connection: ConnectedBlock) => {
        const Icon = getConnectionIcon(connection)
        if (!Icon) return null
        return (
          <Icon key={connection.id} className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
        )
      })}
      {remainingCount > 0 && (
        <span className='text-[14px] text-[var(--text-tertiary)]'>+{remainingCount}</span>
      )}
    </>
  )

  if (!horizontalHandles) {
    return (
      <div className='-translate-x-full -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 flex flex-col items-end gap-[8px] pr-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
        <span className='text-[14px] text-[var(--text-tertiary)] leading-[14px]'>
          {connectionText}
        </span>
        <div className='flex items-center justify-end gap-[4px]'>{connectionIcons}</div>
      </div>
    )
  }

  return (
    <div className='pointer-events-none absolute bottom-full left-0 ml-[8px] flex items-center gap-[8px] pb-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
      <span className='text-[14px] text-[var(--text-tertiary)]'>{connectionText}</span>
      <div className='h-[14px] w-[1px] bg-[var(--text-tertiary)]' />
      <div className='flex items-center gap-[4px]'>{connectionIcons}</div>
    </div>
  )
}
