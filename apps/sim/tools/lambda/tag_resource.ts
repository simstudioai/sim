import type { LambdaTagResourceParams, LambdaTagResourceResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const tagResourceTool: InternalToolConfig<
  LambdaTagResourceParams,
  LambdaTagResourceResponse
> = {
  id: 'lambda_tag_resource',
  name: 'Lambda Tag Resource',
  description: 'Add tags to a Lambda function',
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
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tags to apply, as a flat key/value JSON object',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      resourceArn: params.resourceArn,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to tag Lambda resource')
    }

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
