import type {
  IdentityCenterDescribeAccountParams,
  IdentityCenterDescribeAccountResponse,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const describeAccountTool: ToolConfig<
  IdentityCenterDescribeAccountParams,
  IdentityCenterDescribeAccountResponse
> = {
  id: 'identity_center_describe_account',
  name: 'Identity Center Describe Account',
  description: 'Retrieve details about a specific AWS account by its ID',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'AWS account ID to describe',
    },
  },

  request: {
    url: '/api/tools/identity-center/describe-account',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      accountId: params.accountId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe AWS account')
    }
    return {
      success: true,
      output: {
        id: data.id ?? '',
        arn: data.arn ?? '',
        name: data.name ?? '',
        email: data.email ?? '',
        status: data.status ?? '',
        joinedTimestamp: data.joinedTimestamp ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'AWS account ID' },
    arn: { type: 'string', description: 'AWS account ARN' },
    name: { type: 'string', description: 'Account name' },
    email: { type: 'string', description: 'Root email address of the account' },
    status: { type: 'string', description: 'Account status (ACTIVE, SUSPENDED, etc.)' },
    joinedTimestamp: {
      type: 'string',
      description: 'Date the account joined the organization',
      optional: true,
    },
  },
}
