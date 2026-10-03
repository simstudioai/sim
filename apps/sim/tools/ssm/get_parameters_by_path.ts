import type {
  SsmGetParametersByPathParams,
  SsmGetParametersByPathResponse,
} from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getParametersByPathTool: InternalToolConfig<
  SsmGetParametersByPathParams,
  SsmGetParametersByPathResponse
> = {
  id: 'ssm_get_parameters_by_path',
  name: 'SSM Get Parameters By Path',
  description: 'Read parameters under a Parameter Store hierarchy path',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Hierarchy path to read, starting with a slash (e.g., /prod/app)',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include parameters in nested paths below the given path',
    },
    withDecryption: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return decrypted values for SecureString parameters; ignored for String and StringList parameters',
    },
    parameterFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters, as an array of {Key, Option, Values} objects. Valid keys here: Type, KeyId, Label',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of parameters to return (1-10)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      path: params.path,
      recursive: params.recursive,
      withDecryption: params.withDecryption,
      parameterFilters: params.parameterFilters,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get parameters by path')
    }

    return {
      success: true,
      output: {
        parameters: data.parameters ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    parameters: {
      type: 'json',
      description:
        'Parameters under the path, each with name, type, value, version, arn, dataType, and lastModifiedDate',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: {
      type: 'number',
      description: 'Number of parameters returned',
    },
  },
}
