import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaListLayersParams, LambdaListLayersResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listLayersTool: InternalToolConfig<LambdaListLayersParams, LambdaListLayersResponse> =
  {
    id: 'lambda_list_layers',
    name: 'Lambda List Layers',
    description: 'List Lambda layers and the latest version of each',
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
      compatibleRuntime: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only layers compatible with this runtime, such as python3.13',
      },
      compatibleArchitecture: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return only layers compatible with this instruction set architecture',
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
        ...(isSupplied(params.compatibleRuntime) && {
          compatibleRuntime: params.compatibleRuntime,
        }),
        ...(isSupplied(params.compatibleArchitecture) && {
          compatibleArchitecture: params.compatibleArchitecture,
        }),
        ...(isSupplied(params.marker) && { marker: params.marker }),
        ...(isSupplied(params.maxItems) && { maxItems: params.maxItems }),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          layers: data.output.layers,
          nextMarker: data.output.nextMarker,
        },
      }
    },

    outputs: {
      layers: {
        type: 'array',
        description: 'Layers with their ARNs and latest matching version',
      },
      nextMarker: {
        type: 'string',
        description: 'Pagination token to pass as marker on the next request',
        nullable: true,
      },
    },
  }
