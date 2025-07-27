import { createLogger } from '@/lib/logs/console-logger'
import { WORKFLOW_EXAMPLES } from '../../../../lib/copilot/examples'

const logger = createLogger('GetWorkflowExamplesAPI')

export async function getWorkflowExamples(params: any) {
  logger.info('Getting workflow examples for copilot')

  const { exampleIds } = params

  if (!Array.isArray(exampleIds)) {
    throw new Error('exampleIds must be an array')
  }

  const examples: Record<string, string> = {}
  const notFound: string[] = []

  for (const id of exampleIds) {
    if (WORKFLOW_EXAMPLES[id]) {
      examples[id] = WORKFLOW_EXAMPLES[id]
    } else {
      notFound.push(id)
    }
  }

  return {
    success: true,
    data: {
      examples,
      notFound,
      availableIds: Object.keys(WORKFLOW_EXAMPLES),
    },
  }
}
