import { createLogger } from '@sim/logger'
import { resolveStartCandidates, StartBlockPath } from '@/lib/workflows/triggers/triggers'
import { normalizeName, startsWithUuid } from '@/executor/constants'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('DeploymentUtils')

export interface InputField {
  name: string
  type: string
}

/**
 * Gets the input format from the Start block
 * Returns an array of field definitions with name and type
 */
export function getStartBlockInputFormat(): InputField[] {
  try {
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
      if (inputFormat && Array.isArray(inputFormat)) {
        return inputFormat
          .map((field: { name?: string; type?: string }) => ({
            name: field.name || '',
            type: field.type || 'string',
          }))
          .filter((field) => field.name)
      }
    }
  } catch (error) {
    logger.warn('Error getting start block input format:', error)
  }

  return []
}

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
              case 'file[]':
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

      if (includeStreaming && selectedStreamingOutputs.length > 0) {
        exampleData.stream = true

        const convertedOutputs = selectedStreamingOutputs
          .map((outputId) => {
            if (startsWithUuid(outputId)) {
              const underscoreIndex = outputId.indexOf('_')
              if (underscoreIndex === -1) return null

              const blockId = outputId.substring(0, underscoreIndex)
              const attribute = outputId.substring(underscoreIndex + 1)

              const block = blocks.find((b) => b.id === blockId)
              if (block?.name) {
                return `${normalizeName(block.name)}.${attribute}`
              }
              return null
            }

            const parts = outputId.split('.')
            if (parts.length >= 2) {
              const blockName = parts[0]
              const block = blocks.find(
                (b) => b.name && normalizeName(b.name) === normalizeName(blockName)
              )
              if (!block) {
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
