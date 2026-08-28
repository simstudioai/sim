import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaPublishVersionParams, LambdaPublishVersionResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const publishVersionTool: InternalToolConfig<
  LambdaPublishVersionParams,
  LambdaPublishVersionResponse
> = {
  id: 'lambda_publish_version',
  name: 'Lambda Publish Version',
  description: 'Publish an immutable version from the current code and configuration of a function',
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
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Function name, ARN, or partial ARN (e.g. my-function, or arn:aws:lambda:us-east-1:123456789012:function:my-function)',
    },
    codeSha256: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Publish only if the SHA256 hash of the deployment package matches this value',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the version',
    },
    revisionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Update the resource only if its current revision ID matches this value',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(isSupplied(params.codeSha256) && { codeSha256: params.codeSha256 }),
      ...(isSupplied(params.description) && { description: params.description }),
      ...(isSupplied(params.revisionId) && { revisionId: params.revisionId }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        configuration: data.output.configuration,
      },
    }
  },

  outputs: {
    configuration: {
      type: 'json',
      description:
        "The function's configuration (ARN, runtime, handler, memory, state, layers, VPC, and logging settings)",
    },
  },
}
