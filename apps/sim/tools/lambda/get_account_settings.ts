import type {
  LambdaGetAccountSettingsParams,
  LambdaGetAccountSettingsResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getAccountSettingsTool: InternalToolConfig<
  LambdaGetAccountSettingsParams,
  LambdaGetAccountSettingsResponse
> = {
  id: 'lambda_get_account_settings',
  name: 'Lambda Get Account Settings',
  description: 'Get the Lambda limits and usage of the current AWS account and region',
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
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda account settings')
    }

    return {
      success: true,
      output: {
        accountLimit: data.output.accountLimit,
        accountUsage: data.output.accountUsage,
      },
    }
  },

  outputs: {
    accountLimit: {
      type: 'json',
      description: 'Account-level storage and concurrency limits',
      nullable: true,
    },
    accountUsage: {
      type: 'json',
      description: 'Current code storage used and number of functions deployed',
      nullable: true,
    },
  },
}
