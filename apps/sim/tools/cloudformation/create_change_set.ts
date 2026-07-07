import type {
  CloudFormationCreateChangeSetParams,
  CloudFormationCreateChangeSetResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const createChangeSetTool: ToolConfig<
  CloudFormationCreateChangeSetParams,
  CloudFormationCreateChangeSetResponse
> = {
  id: 'cloudformation_create_change_set',
  name: 'CloudFormation Create Change Set',
  description: 'Preview the changes a stack create or update would make before applying them',
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
      description:
        'Name of the stack to create or update (new name for CREATE type, existing name for UPDATE)',
    },
    changeSetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new change set',
    },
    templateBody: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The CloudFormation template body (JSON or YAML). Required unless usePreviousTemplate is true',
    },
    usePreviousTemplate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reuse the template currently associated with the stack (UPDATE change sets only)',
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
    changeSetType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CREATE (default, new stack), UPDATE (existing stack), or IMPORT (import existing resources)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the change set for reference',
    },
  },

  request: {
    url: '/api/tools/cloudformation/create-change-set',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
      changeSetName: params.changeSetName,
      ...(params.templateBody && { templateBody: params.templateBody }),
      ...(params.usePreviousTemplate !== undefined && {
        usePreviousTemplate: params.usePreviousTemplate,
      }),
      ...(params.parameters && { parameters: params.parameters }),
      ...(params.capabilities && { capabilities: params.capabilities }),
      ...(params.changeSetType && { changeSetType: params.changeSetType }),
      ...(params.description && { description: params.description }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create CloudFormation change set')
    }

    return {
      success: true,
      output: {
        changeSetId: data.output.changeSetId,
        stackId: data.output.stackId,
      },
    }
  },

  outputs: {
    changeSetId: { type: 'string', description: 'The unique ID of the created change set' },
    stackId: { type: 'string', description: 'The unique ID of the target stack' },
  },
}
