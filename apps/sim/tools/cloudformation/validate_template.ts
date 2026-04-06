import type {
  CloudFormationValidateTemplateParams,
  CloudFormationValidateTemplateResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const validateTemplateTool: ToolConfig<
  CloudFormationValidateTemplateParams,
  CloudFormationValidateTemplateResponse
> = {
  id: 'cloudformation_validate_template',
  name: 'CloudFormation Validate Template',
  description: 'Validate a CloudFormation template for syntax and structural correctness',
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
    templateBody: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CloudFormation template body (JSON or YAML)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/validate-template',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      templateBody: params.templateBody,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to validate CloudFormation template')
    }

    return {
      success: true,
      output: {
        description: data.output.description,
        parameters: data.output.parameters,
        capabilities: data.output.capabilities,
        capabilitiesReason: data.output.capabilitiesReason,
        declaredTransforms: data.output.declaredTransforms,
      },
    }
  },

  outputs: {
    description: { type: 'string', description: 'Template description' },
    parameters: {
      type: 'array',
      description: 'Template parameters with defaults and descriptions',
    },
    capabilities: { type: 'array', description: 'Required capabilities (e.g., CAPABILITY_IAM)' },
    capabilitiesReason: { type: 'string', description: 'Reason capabilities are required' },
    declaredTransforms: {
      type: 'array',
      description: 'Transforms used in the template (e.g., AWS::Serverless-2016-10-31)',
    },
  },
}
