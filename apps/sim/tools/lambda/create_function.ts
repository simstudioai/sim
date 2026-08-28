import type { LambdaCreateFunctionParams, LambdaCreateFunctionResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const createFunctionTool: InternalToolConfig<
  LambdaCreateFunctionParams,
  LambdaCreateFunctionResponse
> = {
  id: 'lambda_create_function',
  name: 'Lambda Create Function',
  description:
    'Create a Lambda function from a deployment package in Amazon S3 or a container image',
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
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "ARN of the function's execution role",
    },
    runtime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Runtime identifier such as nodejs22.x or python3.13. Required for .zip packages, omit for container images',
    },
    handler: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entry point in your code, such as index.handler. Required for .zip packages',
    },
    packageType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zip for a .zip file archive (default) or Image for a container image',
    },
    s3Bucket: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amazon S3 bucket holding the deployment package, in the same region as the function',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the function',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds Lambda allows the function to run before stopping it (1-900)',
    },
    memorySize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memory available to the function at runtime in MB (128-32768)',
    },
    ephemeralStorageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Size of the /tmp directory in MB (512-10240)',
    },
    publish: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Publish the first version of the function atomically with creation',
    },
    environment: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment variables as a flat key/value JSON object',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags to apply to the function, as a flat key/value JSON object',
    },
    architectures: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Instruction set architecture: x86_64 or arm64',
    },
    layers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'ARNs of layer versions to add to the function execution environment',
    },
    vpcSubnetIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'VPC subnet IDs the function should attach to',
    },
    vpcSecurityGroupIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'VPC security group IDs the function should use',
    },
    tracingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'X-Ray tracing mode: Active samples and traces requests, PassThrough only traces sampled requests',
    },
    deadLetterTargetArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of an SQS queue or SNS topic that receives failed asynchronous invocations',
    },
    kmsKeyArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ARN of the KMS customer managed key used to encrypt environment variables and snapshots',
    },
    snapStartApplyOn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to PublishedVersions to snapshot the initialized environment when a version is published',
    },
    logFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format the function sends CloudWatch logs in',
    },
    logGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CloudWatch log group the function sends logs to',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      role: params.role,
      ...(params.runtime !== undefined && { runtime: params.runtime }),
      ...(params.handler !== undefined && { handler: params.handler }),
      ...(params.packageType !== undefined && { packageType: params.packageType }),
      ...(params.s3Bucket !== undefined && { s3Bucket: params.s3Bucket }),
      ...(params.s3Key !== undefined && { s3Key: params.s3Key }),
      ...(params.s3ObjectVersion !== undefined && { s3ObjectVersion: params.s3ObjectVersion }),
      ...(params.imageUri !== undefined && { imageUri: params.imageUri }),
      ...(params.sourceKmsKeyArn !== undefined && { sourceKmsKeyArn: params.sourceKmsKeyArn }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.timeout !== undefined && { timeout: params.timeout }),
      ...(params.memorySize !== undefined && { memorySize: params.memorySize }),
      ...(params.ephemeralStorageSize !== undefined && {
        ephemeralStorageSize: params.ephemeralStorageSize,
      }),
      ...(params.publish !== undefined && { publish: params.publish }),
      ...(params.environment !== undefined && { environment: params.environment }),
      ...(params.tags !== undefined && { tags: params.tags }),
      ...(params.architectures !== undefined && { architectures: params.architectures }),
      ...(params.layers !== undefined && { layers: params.layers }),
      ...(params.vpcSubnetIds !== undefined && { vpcSubnetIds: params.vpcSubnetIds }),
      ...(params.vpcSecurityGroupIds !== undefined && {
        vpcSecurityGroupIds: params.vpcSecurityGroupIds,
      }),
      ...(params.tracingMode !== undefined && { tracingMode: params.tracingMode }),
      ...(params.deadLetterTargetArn !== undefined && {
        deadLetterTargetArn: params.deadLetterTargetArn,
      }),
      ...(params.kmsKeyArn !== undefined && { kmsKeyArn: params.kmsKeyArn }),
      ...(params.snapStartApplyOn !== undefined && { snapStartApplyOn: params.snapStartApplyOn }),
      ...(params.logFormat !== undefined && { logFormat: params.logFormat }),
      ...(params.logGroup !== undefined && { logGroup: params.logGroup }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create Lambda function')
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
