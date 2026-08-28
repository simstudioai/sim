import type {
  LambdaGetFunctionConcurrencyParams,
  LambdaGetFunctionConcurrencyResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getFunctionConcurrencyTool: InternalToolConfig<
  LambdaGetFunctionConcurrencyParams,
  LambdaGetFunctionConcurrencyResponse
> = {
  id: 'lambda_get_function_concurrency',
  name: 'Lambda Get Function Concurrency',
  description: 'Get the reserved concurrency configured for a function',
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
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda function concurrency')
    }

    return {
      success: true,
      output: {
        reservedConcurrentExecutions: data.output.reservedConcurrentExecutions,
      },
    }
  },

  outputs: {
    reservedConcurrentExecutions: {
      type: 'number',
      description: 'Concurrency reserved for this function, or null when none is reserved',
      nullable: true,
    },
  },
}
