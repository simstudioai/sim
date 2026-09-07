import type { SsmDescribeParametersParams, SsmDescribeParametersResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeParametersTool: InternalToolConfig<
  SsmDescribeParametersParams,
  SsmDescribeParametersResponse
> = {
  id: 'ssm_describe_parameters',
  name: 'SSM Describe Parameters',
  description: 'List Parameter Store parameter metadata without reading any values',
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
    parameterFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Option, Values} objects. Valid keys: Name, Type, KeyId, Path, Tier, DataType, or tag:<key>',
    },
    shared: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return parameters shared with this account instead of parameters it owns',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of parameters to return (1-50)',
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
      parameterFilters: params.parameterFilters,
      shared: params.shared,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe parameters')
    }

    return {
      success: true,
      output: {
        parameters: data.parameters ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    parameters: {
      type: 'json',
      description:
        'Parameter metadata, each with name, arn, type, keyId, description, tier, version, dataType, allowedPattern, lastModifiedDate, lastModifiedUser, and policies. Values are never included',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of parameters returned',
    },
  },
}
