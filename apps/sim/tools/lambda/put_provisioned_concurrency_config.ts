import type {
  LambdaPutProvisionedConcurrencyConfigParams,
  LambdaPutProvisionedConcurrencyConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const putProvisionedConcurrencyConfigTool: InternalToolConfig<
  LambdaPutProvisionedConcurrencyConfigParams,
  LambdaPutProvisionedConcurrencyConfigResponse
> = {
  id: 'lambda_put_provisioned_concurrency_config',
  name: 'Lambda Set Provisioned Concurrency',
  description: 'Allocate provisioned concurrency to a function version or alias',
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
    provisionedConcurrentExecutions: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of pre-initialized execution environments to allocate',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      qualifier: params.qualifier,
      provisionedConcurrentExecutions: params.provisionedConcurrentExecutions,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set Lambda provisioned concurrency configuration')
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
