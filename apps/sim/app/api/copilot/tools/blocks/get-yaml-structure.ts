import { createLogger } from '@/lib/logs/console-logger'
import { getYamlWorkflowPrompt } from '@/lib/copilot/prompts'
import { BaseCopilotTool } from '../base'

interface GetYamlStructureParams {
  // No parameters needed - just return the YAML structure guide
}

interface YamlStructureResult {
  guide: string
  message: string
}

class GetYamlStructureTool extends BaseCopilotTool<GetYamlStructureParams, YamlStructureResult> {
  readonly id = 'get_yaml_structure'
  readonly displayName = 'Analyzing workflow structure'

  protected async executeImpl(params: GetYamlStructureParams): Promise<YamlStructureResult> {
    return getYamlStructure()
  }
}

// Export the tool instance
export const getYamlStructureTool = new GetYamlStructureTool()

// Implementation function
async function getYamlStructure(): Promise<YamlStructureResult> {
  const logger = createLogger('GetYamlStructure')

  logger.info('Getting YAML structure guide')

  return {
    guide: getYamlWorkflowPrompt(),
    message: 'Complete YAML workflow syntax guide with examples and best practices',
  }
}
