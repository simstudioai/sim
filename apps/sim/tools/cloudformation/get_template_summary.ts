import type {
  CloudFormationGetTemplateSummaryParams,
  CloudFormationGetTemplateSummaryResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const getTemplateSummaryTool: ToolConfig<
  CloudFormationGetTemplateSummaryParams,
  CloudFormationGetTemplateSummaryResponse
> = {
  id: 'cloudformation_get_template_summary',
  name: 'CloudFormation Get Template Summary',
  description:
    'Get a summary of a template or deployed stack: resource types, required capabilities, and parameters, without full validation',
  version: '1.0.0',

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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The CloudFormation template body (JSON or YAML). Required if stackName is not provided',
    },
    stackName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name or ID of a deployed stack to summarize instead of a template body',
    },
  },

  request: {
    url: '/api/tools/cloudformation/get-template-summary',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.templateBody && { templateBody: params.templateBody }),
      ...(params.stackName && { stackName: params.stackName }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudFormation template summary')
    }

    return {
      success: true,
      output: {
        description: data.output.description,
        parameters: data.output.parameters,
        capabilities: data.output.capabilities,
        capabilitiesReason: data.output.capabilitiesReason,
        resourceTypes: data.output.resourceTypes,
        version: data.output.version,
        declaredTransforms: data.output.declaredTransforms,
      },
    }
  },

  outputs: {
    description: { type: 'string', description: 'Template description' },
    parameters: {
      type: 'array',
      description: 'Template parameters with types, defaults, and descriptions',
    },
    capabilities: { type: 'array', description: 'Required capabilities (e.g., CAPABILITY_IAM)' },
    capabilitiesReason: { type: 'string', description: 'Reason capabilities are required' },
    resourceTypes: {
      type: 'array',
      description: 'AWS resource types declared in the template (e.g., AWS::S3::Bucket)',
    },
    version: { type: 'string', description: 'Template format version' },
    declaredTransforms: {
      type: 'array',
      description: 'Transforms used in the template (e.g., AWS::Serverless-2016-10-31)',
    },
  },
}
