import type {
  SsmDescribeInstancePatchesParams,
  SsmDescribeInstancePatchesResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeInstancePatchesTool: InternalToolConfig<
  SsmDescribeInstancePatchesParams,
  SsmDescribeInstancePatchesResponse
> = {
  id: 'ssm_describe_instance_patches',
  name: 'SSM Describe Instance Patches',
  description: 'List the patches reported for one managed node',
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
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Managed node to report patches for (e.g., i-0abc123)',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Values} objects. Valid keys: Classification, KBId, Severity, State',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of patches to return (10-100)',
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
      instanceId: params.instanceId,
      filters: params.filters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe instance patches')
    }

    return {
      success: true,
      output: {
        patches: data.patches ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    patches: {
      type: 'json',
      description:
        'Patches, each with title, kbId, classification, severity, state, installedTime, and cveIds',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of patches returned',
    },
  },
}
