import type { LambdaDeleteAliasParams, LambdaDeleteAliasResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteAliasTool: InternalToolConfig<
  LambdaDeleteAliasParams,
  LambdaDeleteAliasResponse
> = {
  id: 'lambda_delete_alias',
  name: 'Lambda Delete Alias',
  description: 'Delete a Lambda function alias',
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
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      aliasName: params.aliasName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        message: data.output.message,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
