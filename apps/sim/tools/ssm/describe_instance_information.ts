import type {
  SsmDescribeInstanceInformationParams,
  SsmDescribeInstanceInformationResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstanceInformationTool: InternalToolConfig<
  SsmDescribeInstanceInformationParams,
  SsmDescribeInstanceInformationResponse
> = {
  id: 'ssm_describe_instance_information',
  name: 'SSM Describe Instance Information',
  description: 'List managed nodes registered with AWS Systems Manager and their agent status',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Values} objects. Valid keys: InstanceIds, AgentVersion, PingStatus, PlatformTypes, ActivationIds, IamRole, ResourceType, AssociationStatus, SourceIds, SourceTypes, tag-key, or tag:<key>',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of nodes to return (5-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      filters: params.filters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe instance information')
    }

    return {
      success: true,
      output: {
        instances: data.instances ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    instances: {
      type: 'json',
      description:
        'Managed nodes, each with instanceId, pingStatus, lastPingDateTime, agentVersion, isLatestVersion, platformType, platformName, platformVersion, computerName, ipAddress, iamRole, resourceType, and associationStatus',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of managed nodes returned',
    },
  },
}
