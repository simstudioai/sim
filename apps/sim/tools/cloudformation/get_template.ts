import type {
  CloudFormationGetTemplateParams,
  CloudFormationGetTemplateResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const getTemplateTool: ToolConfig<
  CloudFormationGetTemplateParams,
  CloudFormationGetTemplateResponse
> = {
  id: 'cloudformation_get_template',
  name: 'CloudFormation Get Template',
  description: 'Retrieve the template body for a CloudFormation stack',
  version: '1.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    stackName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stack name or ID',
    },
  },

  request: {
    url: '/api/tools/cloudformation/get-template',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudFormation template')
    }

    return {
      success: true,
      output: {
        templateBody: data.output.templateBody,
        stagesAvailable: data.output.stagesAvailable,
      },
    }
  },

  outputs: {
    templateBody: { type: 'string', description: 'The template body as a JSON or YAML string' },
    stagesAvailable: { type: 'array', description: 'Available template stages' },
  },
}
