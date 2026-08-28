import { isSupplied } from '@/tools/lambda/supplied'
import type {
  LambdaListFunctionUrlConfigsParams,
  LambdaListFunctionUrlConfigsResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listFunctionUrlConfigsTool: InternalToolConfig<
  LambdaListFunctionUrlConfigsParams,
  LambdaListFunctionUrlConfigsResponse
> = {
  id: 'lambda_list_function_url_configs',
  name: 'Lambda List Function URLs',
  description: 'List the URL configurations of a function',
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
      ...(isSupplied(params.marker) && { marker: params.marker }),
      ...(isSupplied(params.maxItems) && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        functionUrlConfigs: data.output.functionUrlConfigs,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    functionUrlConfigs: {
      type: 'array',
      description: 'Function URLs with their auth types, invoke modes, and CORS settings',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
