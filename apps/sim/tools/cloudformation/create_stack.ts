import type {
  CloudFormationCreateStackParams,
  CloudFormationCreateStackResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const createStackTool: ToolConfig<
  CloudFormationCreateStackParams,
  CloudFormationCreateStackResponse
> = {
  id: 'cloudformation_create_stack',
  name: 'CloudFormation Create Stack',
  description: 'Create a new CloudFormation stack from a template',
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
      description: 'Name for the new stack (must be unique in the Region)',
    },
    templateBody: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CloudFormation template body (JSON or YAML)',
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
        'Comma-separated capabilities to acknowledge (CAPABILITY_IAM, CAPABILITY_NAMED_IAM, CAPABILITY_AUTO_EXPAND) required when the template creates IAM resources or uses macros',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tags to apply to the stack and its resources (e.g., [{"key": "env", "value": "prod"}])',
    },
    onFailure: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Action to take on creation failure: ROLLBACK (default), DELETE, or DO_NOTHING',
    },
    timeoutInMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount of time before the stack creation times out and rolls back',
    },
  },

  request: {
    url: '/api/tools/cloudformation/create-stack',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
      templateBody: params.templateBody,
      ...(params.parameters && { parameters: params.parameters }),
      ...(params.capabilities && { capabilities: params.capabilities }),
      ...(params.tags && { tags: params.tags }),
      ...(params.onFailure && { onFailure: params.onFailure }),
      ...(params.timeoutInMinutes !== undefined && { timeoutInMinutes: params.timeoutInMinutes }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create CloudFormation stack')
    }

    return {
      success: true,
      output: {
        stackId: data.output.stackId,
      },
    }
  },

  outputs: {
    stackId: { type: 'string', description: 'The unique ID of the created stack' },
  },
}
