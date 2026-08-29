import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaListFunctionsParams, LambdaListFunctionsResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listFunctionsTool: InternalToolConfig<
  LambdaListFunctionsParams,
  LambdaListFunctionsResponse
> = {
  id: 'lambda_list_functions',
  name: 'Lambda List Functions',
  description: 'List Lambda functions with the version-specific configuration of each',
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
    functionVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to ALL to include every published version of each function',
    },
    masterRegion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For Lambda@Edge functions, the region of the master function. Requires functionVersion ALL',
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
      description: 'Maximum number of items to return (1-10000)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(isSupplied(params.functionVersion) && { functionVersion: params.functionVersion }),
      ...(isSupplied(params.masterRegion) && { masterRegion: params.masterRegion }),
      ...(isSupplied(params.marker) && { marker: params.marker }),
      ...(isSupplied(params.maxItems) && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        functions: data.output.functions,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    functions: {
      type: 'array',
      description: 'Lambda functions with their runtime, handler, memory, and state',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
