import type {
  CloudFormationUpdateStackParams,
  CloudFormationUpdateStackResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const updateStackTool: ToolConfig<
  CloudFormationUpdateStackParams,
  CloudFormationUpdateStackResponse
> = {
  id: 'cloudformation_update_stack',
  name: 'CloudFormation Update Stack',
  description: 'Update an existing CloudFormation stack with a new or previous template',
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
    stackName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name or ID of the stack to update',
    },
    templateBody: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The new CloudFormation template body (JSON or YAML). Required unless usePreviousTemplate is true',
    },
    usePreviousTemplate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reuse the template currently associated with the stack instead of providing templateBody',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Template input parameters (e.g., [{"parameterKey": "InstanceType", "parameterValue": "t3.micro"}])',
    },
    capabilities: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated capabilities to acknowledge (CAPABILITY_IAM, CAPABILITY_NAMED_IAM, CAPABILITY_AUTO_EXPAND)',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tags to apply to the stack and its resources (e.g., [{"key": "env", "value": "prod"}])',
    },
  },

  request: {
    url: '/api/tools/cloudformation/update-stack',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
      ...(params.templateBody && { templateBody: params.templateBody }),
      ...(params.usePreviousTemplate !== undefined && {
        usePreviousTemplate: params.usePreviousTemplate,
      }),
      ...(params.parameters && { parameters: params.parameters }),
      ...(params.capabilities && { capabilities: params.capabilities }),
      ...(params.tags && { tags: params.tags }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update CloudFormation stack')
    }

    return {
      success: true,
      output: {
        stackId: data.output.stackId,
      },
    }
  },

  outputs: {
    stackId: { type: 'string', description: 'The unique ID of the updated stack' },
  },
}
