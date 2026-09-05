import type { SsmDeleteParameterParams, SsmDeleteParameterResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteParameterTool: InternalToolConfig<
  SsmDeleteParameterParams,
  SsmDeleteParameterResponse
> = {
  id: 'ssm_delete_parameter',
  name: 'SSM Delete Parameter',
  description: 'Delete a parameter from AWS Systems Manager Parameter Store',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the parameter to delete',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      name: params.name,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete parameter')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        name: data.name ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Operation status message',
    },
    name: {
      type: 'string',
      description: 'Name of the parameter that was deleted',
    },
  },
}
