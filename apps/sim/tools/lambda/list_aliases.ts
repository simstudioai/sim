import type { LambdaListAliasesParams, LambdaListAliasesResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listAliasesTool: InternalToolConfig<
  LambdaListAliasesParams,
  LambdaListAliasesResponse
> = {
  id: 'lambda_list_aliases',
  name: 'Lambda List Aliases',
  description: 'List the aliases of a Lambda function',
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
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Function name, ARN, or partial ARN (e.g. my-function, or arn:aws:lambda:us-east-1:123456789012:function:my-function)',
    },
    aliasFunctionVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only aliases that point to this function version',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token returned by a previous request',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (1-10000)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.aliasFunctionVersion !== undefined && {
        aliasFunctionVersion: params.aliasFunctionVersion,
      }),
      ...(params.marker !== undefined && { marker: params.marker }),
      ...(params.maxItems !== undefined && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Lambda aliases')
    }

    return {
      success: true,
      output: {
        aliases: data.output.aliases,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    aliases: {
      type: 'array',
      description: 'Aliases with their ARNs, target versions, and routing configuration',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
