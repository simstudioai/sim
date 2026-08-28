import type {
  LambdaGetProvisionedConcurrencyConfigParams,
  LambdaGetProvisionedConcurrencyConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getProvisionedConcurrencyConfigTool: InternalToolConfig<
  LambdaGetProvisionedConcurrencyConfigParams,
  LambdaGetProvisionedConcurrencyConfigResponse
> = {
  id: 'lambda_get_provisioned_concurrency_config',
  name: 'Lambda Get Provisioned Concurrency',
  description: 'Get the provisioned concurrency configuration of a function version or alias',
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
    qualifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version number or alias name the configuration applies to',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      qualifier: params.qualifier,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda provisioned concurrency configuration')
    }

    return {
      success: true,
      output: {
        provisionedConcurrency: data.output.provisionedConcurrency,
      },
    }
  },

  outputs: {
    provisionedConcurrency: {
      type: 'json',
      description: 'Requested, available, and allocated provisioned concurrency with its status',
    },
  },
}
