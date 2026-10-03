import type { SsmGetParametersParams, SsmGetParametersResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getParametersTool: InternalToolConfig<
  SsmGetParametersParams,
  SsmGetParametersResponse
> = {
  id: 'ssm_get_parameters',
  name: 'SSM Get Parameters',
  description: 'Read up to ten parameters from AWS Systems Manager Parameter Store by name',
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
    names: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Parameter names to read, as an array of at most 10 strings',
    },
    withDecryption: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return decrypted values for SecureString parameters; ignored for String and StringList parameters',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      names: params.names,
      withDecryption: params.withDecryption,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get parameters')
    }

    return {
      success: true,
      output: {
        parameters: data.parameters ?? [],
        invalidParameters: data.invalidParameters ?? [],
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    parameters: {
      type: 'json',
      description:
        'Parameters that were found, each with name, type, value, version, arn, dataType, and lastModifiedDate',
    },
    invalidParameters: {
      type: 'array',
      description: 'Names that could not be read because they do not exist or are malformed',
    },
    count: {
      type: 'number',
      description: 'Number of parameters returned',
    },
  },
}
