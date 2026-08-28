import type {
  LambdaUpdateFunctionCodeParams,
  LambdaUpdateFunctionCodeResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateFunctionCodeTool: InternalToolConfig<
  LambdaUpdateFunctionCodeParams,
  LambdaUpdateFunctionCodeResponse
> = {
  id: 'lambda_update_function_code',
  name: 'Lambda Update Function Code',
  description: "Update a function's deployment package from Amazon S3 or a container image",
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
    s3Bucket: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amazon S3 bucket holding the new deployment package, in the same region as the function',
    },
    s3Key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amazon S3 key of the .zip package',
    },
    s3ObjectVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version of the Amazon S3 object to use',
    },
    imageUri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amazon ECR URI of the container image to deploy',
    },
    sourceKmsKeyArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "ARN of the KMS customer managed key that encrypts the function's .zip deployment package",
    },
    architectures: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Instruction set architecture: x86_64 or arm64',
    },
    publish: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Publish a new version after updating the code',
    },
    dryRun: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate the request without updating the function',
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
      ...(params.s3Bucket !== undefined && { s3Bucket: params.s3Bucket }),
      ...(params.s3Key !== undefined && { s3Key: params.s3Key }),
      ...(params.s3ObjectVersion !== undefined && { s3ObjectVersion: params.s3ObjectVersion }),
      ...(params.imageUri !== undefined && { imageUri: params.imageUri }),
      ...(params.sourceKmsKeyArn !== undefined && { sourceKmsKeyArn: params.sourceKmsKeyArn }),
      ...(params.architectures !== undefined && { architectures: params.architectures }),
      ...(params.publish !== undefined && { publish: params.publish }),
      ...(params.dryRun !== undefined && { dryRun: params.dryRun }),
      ...(params.revisionId !== undefined && { revisionId: params.revisionId }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update Lambda function code')
    }

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
