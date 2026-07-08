import type {
  CloudFormationDescribeChangeSetParams,
  CloudFormationDescribeChangeSetResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const describeChangeSetTool: ToolConfig<
  CloudFormationDescribeChangeSetParams,
  CloudFormationDescribeChangeSetResponse
> = {
  id: 'cloudformation_describe_change_set',
  name: 'CloudFormation Describe Change Set',
  description: 'View the resource changes a change set would make and its execution status',
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
    changeSetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name or ARN of the change set to describe',
    },
    stackName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name or ID of the stack the change set belongs to (required if changeSetName is not an ARN)',
    },
  },

  request: {
    url: '/api/tools/cloudformation/describe-change-set',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      changeSetName: params.changeSetName,
      ...(params.stackName && { stackName: params.stackName }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudFormation change set')
    }

    return {
      success: true,
      output: {
        changeSetName: data.output.changeSetName,
        changeSetId: data.output.changeSetId,
        stackId: data.output.stackId,
        stackName: data.output.stackName,
        description: data.output.description,
        executionStatus: data.output.executionStatus,
        status: data.output.status,
        statusReason: data.output.statusReason,
        creationTime: data.output.creationTime,
        capabilities: data.output.capabilities,
        changes: data.output.changes,
      },
    }
  },

  outputs: {
    changeSetName: { type: 'string', description: 'Name of the change set' },
    changeSetId: { type: 'string', description: 'The unique ID of the change set' },
    stackId: { type: 'string', description: 'The unique ID of the target stack' },
    stackName: { type: 'string', description: 'Name of the target stack' },
    description: { type: 'string', description: 'Description of the change set' },
    executionStatus: {
      type: 'string',
      description:
        'Whether the change set can be executed (AVAILABLE, UNAVAILABLE, EXECUTE_IN_PROGRESS, EXECUTE_COMPLETE, EXECUTE_FAILED, OBSOLETE)',
    },
    status: {
      type: 'string',
      description:
        'Current status of the change set (CREATE_PENDING, CREATE_IN_PROGRESS, CREATE_COMPLETE, DELETE_COMPLETE, FAILED)',
    },
    statusReason: {
      type: 'string',
      description: 'Reason for the current status, particularly if failed',
    },
    creationTime: { type: 'number', description: 'Timestamp the change set was created' },
    capabilities: { type: 'array', description: 'Capabilities required to execute the change set' },
    changes: {
      type: 'array',
      description:
        'List of resource changes (action, logical/physical resource ID, resource type, replacement)',
    },
  },
}
