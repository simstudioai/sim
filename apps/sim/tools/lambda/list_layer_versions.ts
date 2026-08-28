import type {
  LambdaListLayerVersionsParams,
  LambdaListLayerVersionsResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listLayerVersionsTool: InternalToolConfig<
  LambdaListLayerVersionsParams,
  LambdaListLayerVersionsResponse
> = {
  id: 'lambda_list_layer_versions',
  name: 'Lambda List Layer Versions',
  description: 'List the versions of a Lambda layer',
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
    layerName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name or ARN of the layer',
    },
    compatibleRuntime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only versions compatible with this runtime, such as python3.13',
    },
    compatibleArchitecture: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only versions compatible with this instruction set architecture',
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
      layerName: params.layerName,
      ...(params.compatibleRuntime !== undefined && {
        compatibleRuntime: params.compatibleRuntime,
      }),
      ...(params.compatibleArchitecture !== undefined && {
        compatibleArchitecture: params.compatibleArchitecture,
      }),
      ...(params.marker !== undefined && { marker: params.marker }),
      ...(params.maxItems !== undefined && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Lambda layer versions')
    }

    return {
      success: true,
      output: {
        layerVersions: data.output.layerVersions,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    layerVersions: {
      type: 'array',
      description: 'Layer versions with their ARNs, compatible runtimes, and license info',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
