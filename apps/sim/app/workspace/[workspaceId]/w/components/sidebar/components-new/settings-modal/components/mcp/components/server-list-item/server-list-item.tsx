import { Button } from '@/components/emcn'

/**
 * Formats transport type for display (e.g., "streamable-http" -> "Streamable-HTTP").
 */
export function formatTransportLabel(transport: string): string {
  return transport
    .split('-')
    .map((word) =>
      ['http', 'sse', 'stdio'].includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('-')
}

/**
 * Formats tools count and names for display.
 */
function formatToolsLabel(tools: any[]): string {
  const count = tools.length
  const plural = count !== 1 ? 's' : ''
  const names = count > 0 ? `: ${tools.map((t) => t.name).join(', ')}` : ''
  return `${count} tool${plural}${names}`
}

interface ServerListItemProps {
  server: any
  tools: any[]
  isDeleting: boolean
  onRemove: () => void
  onViewDetails: () => void
}

/**
 * Renders a single MCP server list item with details and delete actions.
 */
export function ServerListItem({
  server,
  tools,
  isDeleting,
  onRemove,
  onViewDetails,
}: ServerListItemProps) {
  const transportLabel = formatTransportLabel(server.transport || 'http')
  const toolsLabel = formatToolsLabel(tools)

  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <span className='max-w-[280px] truncate font-medium text-[14px]'>
            {server.name || 'Unnamed Server'}
          </span>
          <span className='text-[13px] text-[var(--text-secondary)]'>({transportLabel})</span>
        </div>
        <p className='truncate text-[13px] text-[var(--text-muted)]'>{toolsLabel}</p>
      </div>
      <div className='flex flex-shrink-0 items-center gap-[4px]'>
        <Button
          variant='primary'
          onClick={onViewDetails}
          className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
        >
          Details
        </Button>
        <Button variant='ghost' onClick={onRemove} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
