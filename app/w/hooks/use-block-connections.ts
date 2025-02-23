import { shallow } from 'zustand/shallow'
import { useWorkflowStore } from '@/stores/workflow/store'
import { useSubBlockStore } from '@/stores/workflow/subblock/store'

interface Field {
  name: string
  type: string
  description?: string
}

export interface ConnectedBlock {
  id: string
  type: string
  outputType: string | string[]
  name: string
  responseFormat?: {
    fields: Field[]
  }
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  const incomingConnections = edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => {
      const sourceBlock = blocks[edge.source]

      // Get the response format from the subblock store instead
      const responseFormatValue = useSubBlockStore
        .getState()
        .getValue(edge.source, 'responseFormat')

      let responseFormat

      try {
        responseFormat =
          typeof responseFormatValue === 'string' && responseFormatValue
            ? JSON.parse(responseFormatValue)
            : undefined
      } catch (e) {
        console.error('Failed to parse response format:', e)
        responseFormat = undefined
      }

      // Get the default output type from the block's outputs
      const defaultOutputs: Field[] = Object.entries(sourceBlock.outputs || {}).map(([key]) => ({
        name: key,
        type: 'string',
      }))

      // If we have a valid response format, use its fields as the output types
      const outputFields = responseFormat?.fields || defaultOutputs

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        responseFormat,
      }
    })

  return {
    incomingConnections,
    hasIncomingConnections: incomingConnections.length > 0,
  }
}
