import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type ConnectedBlock, useBlockConnections } from '@/app/w/[id]/hooks/use-block-connections'
import { getBlock } from '@/blocks'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
<<<<<<< HEAD
  horizontalHandles, setIsConnecting,
  isDisabled = false,
=======
  horizontalHandles,
  setIsConnecting,
>>>>>>> 0ebc0b67 (fix: truncating workflow block name)
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
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'connectionBlock',
        connectionData: {
          id: connection.id,
          name: connection.name,
          outputType: field ? field.name : connection.outputType,
          sourceBlockId: connection.id,
          fieldType: field?.type,
        },
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setIsConnecting(false)
  }

  // Helper function to extract fields from JSON Schema
  const extractFieldsFromSchema = (connection: ConnectedBlock): ResponseField[] => {
    // Handle legacy format with fields array
    if (connection.responseFormat?.fields) {
      return connection.responseFormat.fields
    }

    // Handle new JSON Schema format
    const schema = connection.responseFormat?.schema || connection.responseFormat
    // Safely check if schema and properties exist
    if (
      !schema ||
      typeof schema !== 'object' ||
      !('properties' in schema) ||
      typeof schema.properties !== 'object'
    ) {
      return []
    }
    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: Array.isArray(prop) ? 'array' : prop.type || 'string',
      description: prop.description,
    }))
  }

  // Extract fields from starter block input format
  const extractFieldsFromStarterInput = (connection: ConnectedBlock): ResponseField[] => {
    // Only process for starter blocks
    if (connection.type !== 'starter') return []

    try {
      // Get input format from subblock store
      const inputFormat = useSubBlockStore.getState().getValue(connection.id, 'inputFormat')

      // Make sure we have a valid input format
      if (!inputFormat || !Array.isArray(inputFormat) || inputFormat.length === 0) {
        return [{ name: 'input', type: 'any' }]
      }

      // Check if any fields have been configured with names
      const hasConfiguredFields = inputFormat.some(
        (field: any) => field.name && field.name.trim() !== ''
      )

      // If no fields have been configured, return the default input field
      if (!hasConfiguredFields) {
        return [{ name: 'input', type: 'any' }]
      }

      // Map input fields to response fields
      return inputFormat.map((field: any) => ({
        name: `input.${field.name}`,
        type: field.type || 'string',
        description: field.description,
      }))
    } catch (e) {
      console.error('Error extracting fields from starter input format:', e)
      return [{ name: 'input', type: 'any' }]
    }
  }

  // Use connections in distance order (already sorted by the hook)
  const sortedConnections = incomingConnections.filter(
    (connection, index, arr) => arr.findIndex((c) => c.id === connection.id) === index
  )

  // Helper function to render a connection card
  const renderConnectionCard = (connection: ConnectedBlock, field?: ResponseField) => {
    // Get block configuration for icon and color
    const blockConfig = getBlock(connection.type)
    const displayName = connection.name // Use the actual block name instead of transforming it
    const Icon = blockConfig?.icon
    const bgColor = blockConfig?.bgColor || '#6B7280' // Fallback to gray

    return (
      <Card
        key={`${connection.id}-${field ? field.name : 'default'}`}
        draggable={!isDisabled}
        onDragStart={(e) => handleDragStart(e, connection, field)}
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

  // Generate all connection cards
  const connectionCards: React.ReactNode[] = []

  sortedConnections.forEach((connection, index) => {
    // Special handling for starter blocks with input format
    if (connection.type === 'starter') {
      const starterFields = extractFieldsFromStarterInput(connection)

      if (starterFields.length > 0) {
        starterFields.forEach((field) => {
          connectionCards.push(renderConnectionCard(connection, field))
        })
        return
      }
    }

    // Regular connection handling
    if (Array.isArray(connection.outputType)) {
      // Handle array of field names
      connection.outputType.forEach((fieldName) => {
        // Try to find field in response format
        const fields = extractFieldsFromSchema(connection)
        const field = fields.find((f) => f.name === fieldName) || {
          name: fieldName,
          type: 'string',
        }

        connectionCards.push(renderConnectionCard(connection, field))
      })
    } else {
      connectionCards.push(renderConnectionCard(connection))
    }
  })

  // Position and layout based on handle orientation - reverse of ports
  // When ports are horizontal: connection blocks on top, aligned to left, closest blocks on bottom row
  // When ports are vertical (default): connection blocks on left, stack vertically, aligned to right
  const containerClasses = horizontalHandles
    ? 'absolute bottom-full left-0 flex max-w-[600px] flex-wrap-reverse gap-2 pb-3'
    : 'absolute top-0 right-full flex max-h-[400px] max-w-[200px] flex-col items-end gap-2 overflow-y-auto pr-3'

  return <div className={containerClasses}>{connectionCards}</div>
}
