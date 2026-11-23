import { toBooleanFromInput } from '@sim/utils/coerce'
import type {
  SecretsManagerListSecretsParams,
  SecretsManagerListSecretsResponse,
} from '@/tools/secrets_manager/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const listSecretsTool: InternalToolConfig<
  SecretsManagerListSecretsParams,
  SecretsManagerListSecretsResponse
> = {
  id: 'secrets_manager_list_secrets',
  name: 'Secrets Manager List Secrets',
  description: 'List secrets stored in AWS Secrets Manager',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
      description: 'Maximum number of secrets to return (1-100, default 100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters as an array of {key, values}. key is one of description, name, tag-key, tag-value, primary-region, owning-service, all (e.g., [{"key":"name","values":["prod/"]}])',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc or desc (default asc)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by: created-date, last-accessed-date, last-changed-date, or name (default created-date)',
    },
    includePlannedDeletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include secrets scheduled for deletion (default false)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
      filters: params.filters,
      sortOrder: params.sortOrder || undefined,
      sortBy: params.sortBy || undefined,
      includePlannedDeletion: toBooleanFromInput(params.includePlannedDeletion),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list secrets')
    }

    return {
      success: true,
      output: {
        secrets: data.secrets ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    secrets: {
      type: 'json',
      description:
        'List of secrets with name, ARN, description, KMS key, rotation Lambda ARN, owning service, primary region, dates, tags, rotation rules/window, and version-to-stage mappings',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of secrets returned' },
  },
}
