import type {
  LambdaPutFunctionRecursionConfigParams,
  LambdaPutFunctionRecursionConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const putFunctionRecursionConfigTool: InternalToolConfig<
  LambdaPutFunctionRecursionConfigParams,
  LambdaPutFunctionRecursionConfigResponse
> = {
  id: 'lambda_put_function_recursion_config',
  name: 'Lambda Set Recursion Config',
  description: 'Set whether Lambda stops a function that invokes itself recursively',
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
    recursiveLoop: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Terminate stops the function after 16 recursive invocations, Allow permits recursion',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      recursiveLoop: params.recursiveLoop,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set Lambda function recursion configuration')
    }

    return {
      success: true,
      output: {
        recursiveLoop: data.output.recursiveLoop,
      },
    }
  },

  outputs: {
    recursiveLoop: {
      type: 'string',
      description: 'The recursion setting now in effect for the function',
      nullable: true,
    },
  },
}
