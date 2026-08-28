import { isSupplied } from '@/tools/lambda/supplied'
import type {
  LambdaDeleteFunctionEventInvokeConfigParams,
  LambdaDeleteFunctionEventInvokeConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteFunctionEventInvokeConfigTool: InternalToolConfig<
  LambdaDeleteFunctionEventInvokeConfigParams,
  LambdaDeleteFunctionEventInvokeConfigResponse
> = {
  id: 'lambda_delete_function_event_invoke_config',
  name: 'Lambda Delete Async Invoke Config',
  description: 'Remove the asynchronous invocation configuration of a function',
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
      description: 'Version number or alias name to act on. Omit to target the function itself',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(isSupplied(params.qualifier) && { qualifier: params.qualifier }),
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
