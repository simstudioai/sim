import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { resolveStartCandidates, StartBlockPath } from '@/lib/workflows/triggers'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DeploymentUtils')

/**
 * Gets the input format example for a workflow's API deployment
 * Returns the -d flag with example data if inputs exist, empty string otherwise
 *
 * @param includeStreaming - Whether to include streaming parameters in the example
 * @param selectedStreamingOutputs - Array of output IDs to stream
 * @returns A string containing the curl -d flag with example data, or empty string if no inputs
 */
export function getInputFormatExample(
  includeStreaming = false,
  selectedStreamingOutputs: string[] = []
): string {
  let inputFormatExample = ''
  try {
    const blocks = Object.values(useWorkflowStore.getState().blocks)
    const candidates = resolveStartCandidates(useWorkflowStore.getState().blocks, {
      execution: 'api',
    })

    const targetCandidate =
      candidates.find((candidate) => candidate.path === StartBlockPath.UNIFIED) ||
      candidates.find((candidate) => candidate.path === StartBlockPath.SPLIT_API) ||
      candidates.find((candidate) => candidate.path === StartBlockPath.SPLIT_INPUT) ||
      candidates.find((candidate) => candidate.path === StartBlockPath.LEGACY_STARTER)

    const targetBlock = targetCandidate?.block

    if (targetBlock) {
      const inputFormat = useSubBlockStore.getState().getValue(targetBlock.id, 'inputFormat')

      const exampleData: Record<string, any> = {}

      if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
        inputFormat.forEach((field: any) => {
          if (field.name) {
            switch (field.type) {
              case 'string':
                exampleData[field.name] = 'example'
                break
              case 'number':
                exampleData[field.name] = 42
                break
              case 'boolean':
                exampleData[field.name] = true
                break
              case 'object':
                exampleData[field.name] = { key: 'value' }
                break
              case 'array':
                exampleData[field.name] = [1, 2, 3]
                break
              case 'files':
                exampleData[field.name] = [
                  {
                    data: 'data:application/pdf;base64,...',
                    type: 'file',
                    name: 'document.pdf',
                    mime: 'application/pdf',
                  },
                ]
                break
            }
          }
        })
      }

      // Add streaming parameters if enabled and outputs are selected
      if (includeStreaming && selectedStreamingOutputs.length > 0) {
        exampleData.stream = true
        // Convert blockId_attribute format to blockName.attribute format for display
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

        const convertedOutputs = selectedStreamingOutputs
          .map((outputId) => {
            // If it starts with a UUID, convert to blockName.attribute format
            if (UUID_REGEX.test(outputId)) {
              const underscoreIndex = outputId.indexOf('_')
              if (underscoreIndex === -1) return null

              const blockId = outputId.substring(0, underscoreIndex)
              const attribute = outputId.substring(underscoreIndex + 1)

              // Find the block by ID and get its name
              const block = blocks.find((b) => b.id === blockId)
              if (block?.name) {
                // Normalize block name: lowercase and remove spaces
                const normalizedBlockName = block.name.toLowerCase().replace(/\s+/g, '')
                return `${normalizedBlockName}.${attribute}`
              }
              // Block not found (deleted), return null to filter out
              return null
            }

            // Already in blockName.attribute format, verify the block exists
            const parts = outputId.split('.')
            if (parts.length >= 2) {
              const blockName = parts[0]
              // Check if a block with this name exists
              const block = blocks.find(
                (b) => b.name?.toLowerCase().replace(/\s+/g, '') === blockName.toLowerCase()
              )
              if (!block) {
                // Block not found (deleted), return null to filter out
                return null
              }
            }

            return outputId
          })
          .filter((output): output is string => output !== null)

        exampleData.selectedOutputs = convertedOutputs
      }

      if (Object.keys(exampleData).length > 0) {
        inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
      }
    }
  } catch (error) {
    logger.warn('Error generating input format example:', error)
  }

  return inputFormatExample
}

