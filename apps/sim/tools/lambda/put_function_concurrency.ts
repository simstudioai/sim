import type {
  LambdaPutFunctionConcurrencyParams,
  LambdaPutFunctionConcurrencyResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const putFunctionConcurrencyTool: InternalToolConfig<
  LambdaPutFunctionConcurrencyParams,
  LambdaPutFunctionConcurrencyResponse
> = {
  id: 'lambda_put_function_concurrency',
  name: 'Lambda Set Function Concurrency',
  description: 'Reserve a share of the account concurrency limit for a function',
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
    reservedConcurrentExecutions: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of simultaneous executions to reserve for this function',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      reservedConcurrentExecutions: params.reservedConcurrentExecutions,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set Lambda function concurrency')
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
      description: 'Concurrency now reserved for this function',
      nullable: true,
    },
  },
}
