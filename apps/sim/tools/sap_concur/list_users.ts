import type { ListUsersParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  scimListResponseOutputProperties,
  transformSapConcurResponse,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const listUsersTool: InternalToolConfig<ListUsersParams, SapConcurResponse> = {
  id: 'sap_concur_list_users',
  name: 'SAP Concur List Users',
  description: 'List Concur user identities (GET /profile/identity/v4.1/Users).',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of users to return (default 100, max 1000)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SCIM v4.1 pagination cursor — the nextCursor value returned by a prior call',
    },
    attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of attributes to include in the response',
    },
    excludedAttributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of attributes to exclude from the response',
    },
  },
  operation: {
    input: (params) => ({
      ...baseSapConcurInput(params),
      path: `/profile/identity/v4.1/Users`,
      method: 'GET',
      query: buildListQuery({
        count: params.count,
        cursor: params.cursor,
        attributes: params.attributes,
        excludedAttributes: params.excludedAttributes,
      }),
    }),
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'SCIM ListResponse with Resources array',
      properties: scimListResponseOutputProperties,
    },
  },
}
