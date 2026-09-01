import type {
  LambdaGetFunctionRecursionConfigParams,
  LambdaGetFunctionRecursionConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getFunctionRecursionConfigTool: InternalToolConfig<
  LambdaGetFunctionRecursionConfigParams,
  LambdaGetFunctionRecursionConfigResponse
> = {
  id: 'lambda_get_function_recursion_config',
  name: 'Lambda Get Recursion Config',
  description: 'Get the recursive loop detection setting of a function',
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
      description:
        'Terminate stops the function after 16 recursive invocations, Allow permits recursion',
      nullable: true,
    },
  },
}
