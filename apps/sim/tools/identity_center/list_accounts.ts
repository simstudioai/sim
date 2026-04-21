import type {
  IdentityCenterListAccountsParams,
  IdentityCenterListAccountsResponse,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const listAccountsTool: ToolConfig<
  IdentityCenterListAccountsParams,
  IdentityCenterListAccountsResponse
> = {
  id: 'identity_center_list_accounts',
  name: 'Identity Center List Accounts',
  description: 'List all AWS accounts in your organization',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of accounts to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  request: {
    url: '/api/tools/identity-center/list-accounts',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AWS accounts')
    }
    return {
      success: true,
      output: {
        accounts: data.accounts ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'List of AWS accounts with id, arn, name, email, status',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of accounts returned' },
  },
}
