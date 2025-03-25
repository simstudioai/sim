import { Card } from '@/components/ui/card'
import { ConnectedBlock, useBlockConnections } from '@/app/w/[id]/hooks/use-block-connections'

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

  // Group connections by their ID for better organization
  const connectionsByBlock = incomingConnections.reduce(
    (acc, connection) => {
      acc[connection.id] = connection
      return acc
    },
    {} as Record<string, ConnectedBlock>
  )

  // Sort connections by name to make it easier to find blocks
  const sortedConnections = Object.values(connectionsByBlock).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  return (
    <div className="absolute -left-[240px] top-0 space-y-2 flex flex-col items-end w-[220px] max-h-[400px] overflow-y-auto">
      {sortedConnections.map((connection) => (
        <div key={connection.id} className="space-y-2">
          {Array.isArray(connection.outputType) ? (
            // Handle array of field names
            connection.outputType.map((fieldName) => {
              // Try to find field in response format
              const fields = extractFieldsFromSchema(connection)
              const field = fields.find((f) => f.name === fieldName) || {
                name: fieldName,
                type: 'string',
              }

              return (
                <Card
                  key={field.name}
                  draggable
                  onDragStart={(e) => handleDragStart(e, connection, field)}
                  onDragEnd={handleDragEnd}
                  className="group flex items-center rounded-lg border bg-card p-2 shadow-sm transition-colors hover:bg-accent/50 cursor-grab active:cursor-grabbing w-fit"
                >
                  <div className="text-sm">
                    <span className="font-medium leading-none">
                      {connection.name.replace(/\s+/g, '').toLowerCase()}
                    </span>
                    <span className="text-muted-foreground">.{field.name}</span>
                  </div>
                </Card>
              )
            })
          ) : (
            <Card
              draggable
              onDragStart={(e) => handleDragStart(e, connection)}
              onDragEnd={handleDragEnd}
              className="group flex items-center rounded-lg border bg-card p-2 shadow-sm transition-colors hover:bg-accent/50 cursor-grab active:cursor-grabbing w-fit"
            >
              <div className="text-sm">
                <span className="font-medium leading-none">
                  {connection.name.replace(/\s+/g, '').toLowerCase()}
                </span>
                <span className="text-muted-foreground">
                  {typeof connection.outputType === 'string' ? `.${connection.outputType}` : ''}
                </span>
              </div>
            </Card>
          )}
        </div>
      ))}
    </div>
  )
}
