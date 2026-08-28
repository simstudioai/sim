import type {
  LambdaPutFunctionEventInvokeConfigParams,
  LambdaPutFunctionEventInvokeConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const putFunctionEventInvokeConfigTool: InternalToolConfig<
  LambdaPutFunctionEventInvokeConfigParams,
  LambdaPutFunctionEventInvokeConfigResponse
> = {
  id: 'lambda_put_function_event_invoke_config',
  name: 'Lambda Set Async Invoke Config',
  description: 'Configure retry limits and destinations for asynchronous invocations of a function',
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
    maximumRetryAttempts: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Times Lambda retries a failed asynchronous invocation (0-2)',
    },
    maximumEventAgeInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum age of an event Lambda will still process (60-21600)',
    },
    onSuccessDestination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the destination that receives successful invocation records',
    },
    onFailureDestination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the destination that receives failed invocation records',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
      ...(params.maximumRetryAttempts !== undefined && {
        maximumRetryAttempts: params.maximumRetryAttempts,
      }),
      ...(params.maximumEventAgeInSeconds !== undefined && {
        maximumEventAgeInSeconds: params.maximumEventAgeInSeconds,
      }),
      ...(params.onSuccessDestination !== undefined && {
        onSuccessDestination: params.onSuccessDestination,
      }),
      ...(params.onFailureDestination !== undefined && {
        onFailureDestination: params.onFailureDestination,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set Lambda asynchronous invocation configuration')
    }

    return {
      success: true,
      output: {
        eventInvokeConfig: data.output.eventInvokeConfig,
      },
    }
  },

  outputs: {
    eventInvokeConfig: {
      type: 'json',
      description: 'Asynchronous invocation retry limits and success/failure destinations',
    },
  },
}
