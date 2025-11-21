import { useBlockConnections } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'

interface ConnectionsProps {
  blockId: string
}

/**
 * Displays incoming connections at the bottom left of the workflow block
 */
export function Connections({ blockId }: ConnectionsProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const connectionCount = incomingConnections.length
  const connectionText = `${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`

  return (
    <div className='pointer-events-none absolute top-full left-0 ml-[8px] flex items-center gap-[8px] pt-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
      <span className='text-[12px] text-[var(--text-tertiary)]'>{connectionText}</span>
    </div>
  )
}
