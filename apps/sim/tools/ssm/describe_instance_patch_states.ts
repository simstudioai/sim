import type {
  SsmDescribeInstancePatchStatesParams,
  SsmDescribeInstancePatchStatesResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstancePatchStatesTool: InternalToolConfig<
  SsmDescribeInstancePatchStatesParams,
  SsmDescribeInstancePatchStatesResponse
> = {
  id: 'ssm_describe_instance_patch_states',
  name: 'SSM Describe Instance Patch States',
  description: 'Read patch compliance summaries for a set of managed nodes',
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
    instanceIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Managed node IDs to summarize, as an array of at most 50 strings',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of patch states to return (10-100)',
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
      instanceIds: params.instanceIds,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe instance patch states')
    }

    return {
      success: true,
      output: {
        instancePatchStates: data.instancePatchStates ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    instancePatchStates: {
      type: 'json',
      description:
        'Patch states, each with instanceId, patchGroup, baselineId, operation, operationStartTime, operationEndTime, installedCount, missingCount, failedCount, notApplicableCount, criticalNonCompliantCount, and securityNonCompliantCount',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of patch states returned',
    },
  },
}
