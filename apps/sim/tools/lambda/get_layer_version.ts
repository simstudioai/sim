import type {
  LambdaGetLayerVersionParams,
  LambdaGetLayerVersionResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getLayerVersionTool: InternalToolConfig<
  LambdaGetLayerVersionParams,
  LambdaGetLayerVersionResponse
> = {
  id: 'lambda_get_layer_version',
  name: 'Lambda Get Layer Version',
  description: 'Get details and a download link for a specific layer version',
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
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version number of the layer',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      layerName: params.layerName,
      versionNumber: params.versionNumber,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda layer version')
    }

    return {
      success: true,
      output: {
        layerVersion: data.output.layerVersion,
      },
    }
  },

  outputs: {
    layerVersion: {
      type: 'json',
      description:
        'The layer version with its ARN, compatible runtimes, and a presigned content download URL',
    },
  },
}
