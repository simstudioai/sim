import { isSupplied } from '@/tools/lambda/supplied'
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
    functionTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds Lambda allows the function to run before stopping it (1-900). Named functionTimeout because the shared tool executor reserves `timeout` for its own request deadline',
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
      description: 'Instruction set architecture: exactly one of x86_64 or arm64',
    },
    layers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'ARNs of layer versions to add to the function execution environment Pass [] to remove all of them on an update.',
    },
    vpcSubnetIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'VPC subnet IDs the function should attach to Pass [] to remove all of them on an update.',
    },
    vpcSecurityGroupIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'VPC security group IDs the function should use Pass [] to remove all of them on an update.',
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
      ...(isSupplied(params.runtime) && { runtime: params.runtime }),
      ...(isSupplied(params.handler) && { handler: params.handler }),
      ...(isSupplied(params.packageType) && { packageType: params.packageType }),
      ...(isSupplied(params.s3Bucket) && { s3Bucket: params.s3Bucket }),
      ...(isSupplied(params.s3Key) && { s3Key: params.s3Key }),
      ...(isSupplied(params.s3ObjectVersion) && { s3ObjectVersion: params.s3ObjectVersion }),
      ...(isSupplied(params.imageUri) && { imageUri: params.imageUri }),
      ...(isSupplied(params.sourceKmsKeyArn) && { sourceKmsKeyArn: params.sourceKmsKeyArn }),
      ...(isSupplied(params.description) && { description: params.description }),
      ...(isSupplied(params.functionTimeout) && { functionTimeout: params.functionTimeout }),
      ...(isSupplied(params.memorySize) && { memorySize: params.memorySize }),
      ...(isSupplied(params.ephemeralStorageSize) && {
        ephemeralStorageSize: params.ephemeralStorageSize,
      }),
      ...(isSupplied(params.publish) && { publish: params.publish }),
      ...(isSupplied(params.environment) && { environment: params.environment }),
      ...(isSupplied(params.tags) && { tags: params.tags }),
      ...(isSupplied(params.architectures) && { architectures: params.architectures }),
      ...(isSupplied(params.layers) && { layers: params.layers }),
      ...(isSupplied(params.vpcSubnetIds) && { vpcSubnetIds: params.vpcSubnetIds }),
      ...(isSupplied(params.vpcSecurityGroupIds) && {
        vpcSecurityGroupIds: params.vpcSecurityGroupIds,
      }),
      ...(isSupplied(params.tracingMode) && { tracingMode: params.tracingMode }),
      ...(isSupplied(params.deadLetterTargetArn) && {
        deadLetterTargetArn: params.deadLetterTargetArn,
      }),
      ...(isSupplied(params.kmsKeyArn) && { kmsKeyArn: params.kmsKeyArn }),
      ...(isSupplied(params.snapStartApplyOn) && { snapStartApplyOn: params.snapStartApplyOn }),
      ...(isSupplied(params.logFormat) && { logFormat: params.logFormat }),
      ...(isSupplied(params.logGroup) && { logGroup: params.logGroup }),
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
