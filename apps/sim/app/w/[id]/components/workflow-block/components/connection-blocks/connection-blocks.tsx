import { Card } from '@/components/ui/card'
import { type ConnectedBlock, useBlockConnections } from '@/app/w/[id]/hooks/use-block-connections'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface ConnectionBlocksProps {
  blockId: string
  setIsConnecting: (isConnecting: boolean) => void
}

interface ResponseField {
  name: string
  type: string
  description?: string
}

export function ConnectionBlocks({ blockId, setIsConnecting }: ConnectionBlocksProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    connection: ConnectedBlock,
    field?: ResponseField
  ) => {
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

  // Deduplicate connections by ID
  const connectionMap = incomingConnections.reduce(
    (acc, connection) => {
      acc[connection.id] = connection
      return acc
    },
    {} as Record<string, ConnectedBlock>
  )

  // Sort connections by name
  const sortedConnections = Object.values(connectionMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  // Helper function to render a connection card
  const renderConnectionCard = (connection: ConnectedBlock, field?: ResponseField) => {
    const displayName = connection.name.replace(/\s+/g, '').toLowerCase()

    return (
      <Card
        key={`${field ? field.name : connection.id}`}
        draggable
        onDragStart={(e) => handleDragStart(e, connection, field)}
        onDragEnd={handleDragEnd}
        className='group flex w-max cursor-grab items-center rounded-lg border bg-card p-2 shadow-sm transition-colors hover:bg-accent/50 active:cursor-grabbing'
      >
        <div className='text-sm'>
          <span className='font-medium leading-none'>{displayName}</span>
          <span className='text-muted-foreground'>
            {field
              ? `.${field.name}`
              : typeof connection.outputType === 'string'
                ? `.${connection.outputType}`
                : ''}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <div className='absolute top-0 right-full flex max-h-[400px] flex-col items-end space-y-2 overflow-y-auto pr-5'>
      {sortedConnections.map((connection, index) => {
        // Special handling for starter blocks with input format
        if (connection.type === 'starter') {
          const starterFields = extractFieldsFromStarterInput(connection)

          if (starterFields.length > 0) {
            return (
              <div key={connection.id} className='space-y-2'>
                {starterFields.map((field) => renderConnectionCard(connection, field))}
              </div>
            )
          }
        }

        // Regular connection handling
        return (
          <div key={`${connection.id}-${index}`} className='space-y-2'>
            {Array.isArray(connection.outputType)
              ? // Handle array of field names
                connection.outputType.map((fieldName) => {
                  // Try to find field in response format
                  const fields = extractFieldsFromSchema(connection)
                  const field = fields.find((f) => f.name === fieldName) || {
                    name: fieldName,
                    type: 'string',
                  }

                  return renderConnectionCard(connection, field)
                })
              : renderConnectionCard(connection)}
          </div>
        )
      })}
    </div>
  )
}
