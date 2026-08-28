import { isSupplied } from '@/tools/lambda/supplied'
import type {
  LambdaUpdateFunctionConfigurationParams,
  LambdaUpdateFunctionConfigurationResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateFunctionConfigurationTool: InternalToolConfig<
  LambdaUpdateFunctionConfigurationParams,
  LambdaUpdateFunctionConfigurationResponse
> = {
  id: 'lambda_update_function_configuration',
  name: 'Lambda Update Function Configuration',
  description:
    "Update a function's settings such as memory, timeout, role, and environment variables",
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
      required: false,
      visibility: 'user-or-llm',
      description: "ARN of the function's execution role",
    },
    runtime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Runtime identifier such as nodejs22.x or python3.13',
    },
    handler: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entry point in your code, such as index.handler',
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
    environment: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Environment variables as a flat key/value JSON object. Replaces the existing set',
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
      ...(isSupplied(params.role) && { role: params.role }),
      ...(isSupplied(params.runtime) && { runtime: params.runtime }),
      ...(isSupplied(params.handler) && { handler: params.handler }),
      ...(isSupplied(params.description) && { description: params.description }),
      ...(isSupplied(params.functionTimeout) && { functionTimeout: params.functionTimeout }),
      ...(isSupplied(params.memorySize) && { memorySize: params.memorySize }),
      ...(isSupplied(params.ephemeralStorageSize) && {
        ephemeralStorageSize: params.ephemeralStorageSize,
      }),
      ...(isSupplied(params.environment) && { environment: params.environment }),
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
