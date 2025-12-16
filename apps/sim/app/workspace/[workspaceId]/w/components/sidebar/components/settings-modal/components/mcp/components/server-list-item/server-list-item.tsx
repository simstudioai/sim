import { AlertCircle } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'

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

function formatToolsLabel(tools: any[], connectionStatus?: string): string {
  if (connectionStatus === 'error') {
    return 'Unable to connect'
  }
  const count = tools.length
  const plural = count !== 1 ? 's' : ''
  const names = count > 0 ? `: ${tools.map((t) => t.name).join(', ')}` : ''
  return `${count} tool${plural}${names}`
}

interface ServerListItemProps {
  server: any
  tools: any[]
  isDeleting: boolean
  isLoadingTools?: boolean
  onRemove: () => void
  onViewDetails: () => void
}

export function ServerListItem({
  server,
  tools,
  isDeleting,
  isLoadingTools = false,
  onRemove,
  onViewDetails,
}: ServerListItemProps) {
  const transportLabel = formatTransportLabel(server.transport || 'http')
  const toolsLabel = formatToolsLabel(tools, server.connectionStatus)
  const isError = server.connectionStatus === 'error'

  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          {isError && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <AlertCircle className='h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400' />
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span className='text-sm'>{server.lastError || 'Failed to connect to server'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
          )}
          <span className='max-w-[200px] truncate font-medium text-[14px]'>
            {server.name || 'Unnamed Server'}
          </span>
          <span className='text-[13px] text-[var(--text-secondary)]'>({transportLabel})</span>
        </div>
        <p
          className={`truncate text-[13px] ${isError ? 'text-red-500 dark:text-red-400' : 'text-[var(--text-muted)]'}`}
        >
          {isLoadingTools && tools.length === 0 ? 'Loading...' : toolsLabel}
        </p>
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
