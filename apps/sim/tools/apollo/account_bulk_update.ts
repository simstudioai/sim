import type {
  ApolloAccountBulkUpdateParams,
  ApolloAccountBulkUpdateResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloAccountBulkUpdateTool: ToolConfig<
  ApolloAccountBulkUpdateParams,
  ApolloAccountBulkUpdateResponse
> = {
  id: 'apollo_account_bulk_update',
  name: 'Apollo Bulk Update Accounts',
  description:
    'Update up to 1000 existing accounts at once in your Apollo database (higher limit than contacts!). Each account must include an id field. Master key required.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key (master key required)',
    },
    account_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of account IDs to update with the same values (max 1000). Use with name/owner_id for uniform updates. Use either this OR account_attributes.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'When using account_ids, apply this name to all accounts',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'When using account_ids, apply this owner to all accounts',
    },
    account_attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of account objects with individual updates (each must include id). Example: [{"id": "acc1", "name": "Acme", "owner_id": "u1", "account_stage_id": "s1", "typed_custom_fields": {"field_id": "value"}}]',
    },
    async: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'When true, processes the update asynchronously. Only supported when using account_ids; returns 422 if used with account_attributes.',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/accounts/bulk_update',
    method: 'POST',
    headers: (params: ApolloAccountBulkUpdateParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloAccountBulkUpdateParams) => {
      const body: Record<string, unknown> = {}
      if (params.account_ids && params.account_ids.length > 0) {
        body.account_ids = params.account_ids.slice(0, 1000)
      }
      if (params.name) body.name = params.name
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.account_attributes) {
        if (Array.isArray(params.account_attributes)) {
          if (params.account_attributes.length > 0) {
            body.account_attributes = params.account_attributes.slice(0, 1000)
          }
        } else if (
          typeof params.account_attributes === 'object' &&
          Object.keys(params.account_attributes).length > 0
        ) {
          body.account_attributes = params.account_attributes
        }
      }
      const hasUpdateFields = body.account_attributes || body.name || body.owner_id
      if (!hasUpdateFields) {
        throw new Error(
          'Apollo account bulk update requires update fields. Provide account_attributes (array of per-account updates with id, or single object paired with account_ids), or pair account_ids with name/owner_id to apply uniformly.'
        )
      }
      if (!body.account_ids && !body.account_attributes) {
        throw new Error(
          'Apollo account bulk update requires account_ids (with name/owner_id) or account_attributes (with embedded ids).'
        )
      }
      if (body.account_attributes && !Array.isArray(body.account_attributes) && !body.account_ids) {
        throw new Error(
          'Apollo account bulk update with object-form account_attributes requires account_ids to identify which accounts to update.'
        )
      }
      if (body.account_ids && Array.isArray(body.account_attributes)) {
        throw new Error(
          'Apollo account bulk update cannot combine account_ids with array-form account_attributes. Use account_ids with name/owner_id (or object-form account_attributes), or use array-form account_attributes alone (each entry carries its own id).'
        )
      }
      if (params.async !== undefined) body.async = params.async
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        message: data.message ?? null,
        account_ids: data.account_ids ?? [],
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Confirmation message from Apollo',
      optional: true,
    },
    account_ids: {
      type: 'json',
      description: 'IDs of accounts that were updated',
    },
  },
}
