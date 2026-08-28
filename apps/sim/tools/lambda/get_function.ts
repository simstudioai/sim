import type { LambdaGetFunctionParams, LambdaGetFunctionResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getFunctionTool: InternalToolConfig<
  LambdaGetFunctionParams,
  LambdaGetFunctionResponse
> = {
  id: 'lambda_get_function',
  name: 'Lambda Get Function',
  description: "Get a function's configuration, code location, tags, and reserved concurrency",
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
    qualifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number or alias name to act on (defaults to $LATEST)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda function')
    }

    return {
      success: true,
      output: {
        configuration: data.output.configuration,
        code: data.output.code,
        tags: data.output.tags,
        reservedConcurrentExecutions: data.output.reservedConcurrentExecutions,
      },
    }
  },

  outputs: {
    configuration: {
      type: 'json',
      description:
        "The function's configuration (ARN, runtime, handler, memory, state, layers, VPC, and logging settings)",
    },
    code: {
      type: 'json',
      description: 'Presigned download URL for the deployment package, or the container image URI',
      nullable: true,
    },
    tags: {
      type: 'json',
      description: "The function's tags",
    },
    reservedConcurrentExecutions: {
      type: 'number',
      description: 'Concurrency reserved for this function, if any',
      nullable: true,
    },
  },
}
