import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaUpdateAliasParams, LambdaUpdateAliasResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateAliasTool: InternalToolConfig<
  LambdaUpdateAliasParams,
  LambdaUpdateAliasResponse
> = {
  id: 'lambda_update_alias',
  name: 'Lambda Update Alias',
  description: 'Update the target version, description, or traffic weights of an alias',
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
      description: 'Name of the alias',
    },
    aliasFunctionVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Function version the alias should point to',
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
    revisionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Update the resource only if its current revision ID matches this value',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      aliasName: params.aliasName,
      ...(isSupplied(params.aliasFunctionVersion) && {
        aliasFunctionVersion: params.aliasFunctionVersion,
      }),
      ...(isSupplied(params.description) && { description: params.description }),
      ...(isSupplied(params.additionalVersionWeights) && {
        additionalVersionWeights: params.additionalVersionWeights,
      }),
      ...(isSupplied(params.revisionId) && { revisionId: params.revisionId }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

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
