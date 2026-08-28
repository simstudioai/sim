import type { LambdaUntagResourceParams, LambdaUntagResourceResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const untagResourceTool: InternalToolConfig<
  LambdaUntagResourceParams,
  LambdaUntagResourceResponse
> = {
  id: 'lambda_untag_resource',
  name: 'Lambda Untag Resource',
  description: 'Remove tags from a Lambda function',
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
    tagKeys: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Tag keys to remove',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      resourceArn: params.resourceArn,
      tagKeys: params.tagKeys,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        message: data.output.message,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
