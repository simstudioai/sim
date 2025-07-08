import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  type ConnectedBlock,
  useBlockConnections,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-connections'
import { getBlock } from '@/blocks'

interface ConnectionBlocksProps {
  blockId: string
  horizontalHandles: boolean
  setIsConnecting: (isConnecting: boolean) => void
  isDisabled?: boolean
}

interface ResponseField {
  name: string
  type: string
  description?: string
}

export function ConnectionBlocks({
  blockId,
  horizontalHandles,
  setIsConnecting,
  isDisabled = false,
}: ConnectionBlocksProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    connection: ConnectedBlock,
    field?: ResponseField
  ) => {
    if (isDisabled) {
      e.preventDefault()
      return
    }

    e.stopPropagation() // Prevent parent drag handlers from firing
    setIsConnecting(true)

    // If no specific field is provided, use all available output types
    const outputType = field ? field.name : connection.outputType

    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'connectionBlock',
        connectionData: {
          id: connection.id,
          name: connection.name,
          outputType: outputType,
          sourceBlockId: connection.id,
          fieldType: field?.type,
          // Include all available output types for reference
          allOutputTypes: Array.isArray(connection.outputType)
            ? connection.outputType
            : [connection.outputType],
        },
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setIsConnecting(false)
  }

  // Use connections in distance order (already sorted and deduplicated by the hook)
  const sortedConnections = incomingConnections

  // Helper function to render a connection card
  const renderConnectionCard = (connection: ConnectedBlock) => {
    // Get block configuration for icon and color
    const blockConfig = getBlock(connection.type)
    const displayName = connection.name // Use the actual block name instead of transforming it

    // Handle special blocks that aren't in the registry (loop and parallel)
    let Icon = blockConfig?.icon
    let bgColor = blockConfig?.bgColor || '#6B7280' // Fallback to gray

    if (!blockConfig) {
      if (connection.type === 'loop') {
        Icon = RepeatIcon as typeof Icon
        bgColor = '#2FB3FF' // Blue color for loop blocks
      } else if (connection.type === 'parallel') {
        Icon = SplitIcon as typeof Icon
        bgColor = '#FEE12B' // Yellow color for parallel blocks
      }
    }

    return (
      <Card
        key={`${connection.id}-${connection.name}`}
        draggable={!isDisabled}
        onDragStart={(e) => handleDragStart(e, connection)}
        onDragEnd={handleDragEnd}
        className={cn(
          'group flex w-max items-center gap-2 rounded-lg border bg-card p-2 shadow-sm transition-colors',
          !isDisabled
            ? 'cursor-grab hover:bg-accent/50 active:cursor-grabbing'
            : 'cursor-not-allowed opacity-60'
        )}
      >
        {/* Block icon with color */}
        {Icon && (
          <div
            className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
            style={{ backgroundColor: bgColor }}
          >
            <Icon className='h-3 w-3 text-white' />
          </div>
        )}
        <div className='text-sm'>
          <span className='font-medium leading-none'>{displayName}</span>
        </div>
      </Card>
    )
  }

  // Generate all connection cards - one per block, not per output field
  const connectionCards: React.ReactNode[] = []

  sortedConnections.forEach((connection) => {
    connectionCards.push(renderConnectionCard(connection))
  })

  // Position and layout based on handle orientation - reverse of ports
  // When ports are horizontal: connection blocks on top, aligned to left, closest blocks on bottom row
  // When ports are vertical (default): connection blocks on left, stack vertically, aligned to right
  const containerClasses = horizontalHandles
    ? 'absolute bottom-full left-0 flex max-w-[600px] flex-wrap-reverse gap-2 pb-3'
    : 'absolute top-0 right-full flex max-h-[400px] max-w-[200px] flex-col items-end gap-2 overflow-y-auto pr-3'

  return <div className={containerClasses}>{connectionCards}</div>
}
