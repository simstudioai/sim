import type {
  CloudFormationDescribeChangeSetParams,
  CloudFormationDescribeChangeSetResponse,
} from '@/tools/cloudformation/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const describeChangeSetTool: InternalToolConfig<
  CloudFormationDescribeChangeSetParams,
  CloudFormationDescribeChangeSetResponse
> = {
  id: 'cloudformation_describe_change_set',
  name: 'CloudFormation Describe Change Set',
  description: 'View the resource changes a change set would make and its execution status',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous call to fetch the next page of changes',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      changeSetName: params.changeSetName,
      ...(params.stackName && { stackName: params.stackName }),
      ...(params.nextToken && { nextToken: params.nextToken }),
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
        parameters: data.output.parameters ?? [],
        tags: data.output.tags ?? [],
        notificationArns: data.output.notificationArns ?? [],
        includeNestedStacks: data.output.includeNestedStacks,
        parentChangeSetId: data.output.parentChangeSetId,
        rootChangeSetId: data.output.rootChangeSetId,
        onStackFailure: data.output.onStackFailure,
        importExistingResources: data.output.importExistingResources,
        nextToken: data.output.nextToken ?? null,
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
        'List of resource changes (action, logicalResourceId, physicalResourceId, resourceType, replacement, type, policyAction, scope, changeSetId, details [{attribute, name, requiresRecreation, evaluation, changeSource, causingEntity}])',
    },
    parameters: {
      type: 'array',
      description:
        'Stack parameters for the change set (parameterKey, parameterValue, usePreviousValue, resolvedValue)',
      optional: true,
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the change set (key, value)',
      optional: true,
    },
    notificationArns: {
      type: 'array',
      description: 'SNS topic ARNs that receive stack event notifications',
      optional: true,
    },
    includeNestedStacks: {
      type: 'boolean',
      description: 'Whether change sets were created for nested stacks',
      optional: true,
    },
    parentChangeSetId: {
      type: 'string',
      description: 'ID of the parent change set, for nested change sets',
      optional: true,
    },
    rootChangeSetId: {
      type: 'string',
      description: 'ID of the top-level change set, for nested change sets',
      optional: true,
    },
    onStackFailure: {
      type: 'string',
      description: 'Behavior when stack operations fail (DO_NOTHING, ROLLBACK, DELETE)',
      optional: true,
    },
    importExistingResources: {
      type: 'boolean',
      description: 'Whether the change set imports resources that already exist',
      optional: true,
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of changes, if more remain',
      optional: true,
    },
  },
}
