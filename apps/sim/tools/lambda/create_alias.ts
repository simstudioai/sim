import type { LambdaCreateAliasParams, LambdaCreateAliasResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const createAliasTool: InternalToolConfig<
  LambdaCreateAliasParams,
  LambdaCreateAliasResponse
> = {
  id: 'lambda_create_alias',
  name: 'Lambda Create Alias',
  description: 'Create an alias that points to a published function version',
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
    aliasName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the alias, such as prod or staging',
    },
    aliasFunctionVersion: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Function version the alias points to',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the alias',
    },
    additionalVersionWeights: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Weighted routing as a JSON object mapping a second version to the fraction of traffic it receives, e.g. {"2": 0.1}',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      aliasName: params.aliasName,
      aliasFunctionVersion: params.aliasFunctionVersion,
      ...(params.description !== undefined && { description: params.description }),
      ...(params.additionalVersionWeights !== undefined && {
        additionalVersionWeights: params.additionalVersionWeights,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create Lambda alias')
    }

    return {
      success: true,
      output: {
        alias: data.output.alias,
      },
    }
  },

  outputs: {
    alias: {
      type: 'json',
      description: 'The alias with its ARN, target version, and routing configuration',
    },
  },
}
