import { createLogger } from '@/lib/logs/console-logger'
import { WORKFLOW_EXAMPLES } from '@/lib/copilot/examples'
import { BaseCopilotTool } from '../base'

interface GetWorkflowExamplesParams {
  exampleIds: string[]
}

interface WorkflowExamplesResult {
  examples: Record<string, string>
  notFound: string[]
  availableIds: string[]
}

class GetWorkflowExamplesTool extends BaseCopilotTool<GetWorkflowExamplesParams, WorkflowExamplesResult> {
  readonly id = 'get_workflow_examples'
  readonly displayName = 'Getting workflow examples'

  protected async executeImpl(params: GetWorkflowExamplesParams): Promise<WorkflowExamplesResult> {
    return getWorkflowExamples(params)
  }
}

// Export the tool instance
export const getWorkflowExamplesTool = new GetWorkflowExamplesTool()

// Implementation function
async function getWorkflowExamples(params: GetWorkflowExamplesParams): Promise<WorkflowExamplesResult> {
  const logger = createLogger('GetWorkflowExamples')
  
  // Strict validation - exampleIds is required
  if (!params || !params.exampleIds || !Array.isArray(params.exampleIds) || params.exampleIds.length === 0) {
    throw new Error('exampleIds parameter is required and must be a non-empty array of example IDs')
  }
  
  const { exampleIds } = params

  logger.info('Getting workflow examples for copilot', { exampleCount: exampleIds.length })

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
    examples,
    notFound,
    availableIds: Object.keys(WORKFLOW_EXAMPLES),
  }
}
