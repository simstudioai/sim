import type {
  LambdaListFunctionEventInvokeConfigsParams,
  LambdaListFunctionEventInvokeConfigsResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listFunctionEventInvokeConfigsTool: InternalToolConfig<
  LambdaListFunctionEventInvokeConfigsParams,
  LambdaListFunctionEventInvokeConfigsResponse
> = {
  id: 'lambda_list_function_event_invoke_configs',
  name: 'Lambda List Async Invoke Configs',
  description: 'List the asynchronous invocation configurations of a function',
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
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token returned by a previous request',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (1-50)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.marker !== undefined && { marker: params.marker }),
      ...(params.maxItems !== undefined && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Lambda asynchronous invocation configurations')
    }

    return {
      success: true,
      output: {
        eventInvokeConfigs: data.output.eventInvokeConfigs,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    eventInvokeConfigs: {
      type: 'array',
      description: 'Asynchronous invocation configurations for the function versions and aliases',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
