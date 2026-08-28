import type { LambdaListTagsParams, LambdaListTagsResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listTagsTool: InternalToolConfig<LambdaListTagsParams, LambdaListTagsResponse> = {
  id: 'lambda_list_tags',
  name: 'Lambda List Tags',
  description: 'List the tags applied to a Lambda function',
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
    resourceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The function's Amazon Resource Name (ARN)",
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      resourceArn: params.resourceArn,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Lambda tags')
    }

    return {
      success: true,
      output: {
        tags: data.output.tags,
      },
    }
  },

  outputs: {
    tags: { type: 'json', description: "The resource's tags as a key/value object" },
  },
}
