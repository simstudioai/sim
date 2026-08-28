import type { DeleteListItemParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteListItemTool: InternalToolConfig<DeleteListItemParams, SapConcurResponse> = {
  id: 'sap_concur_delete_list_item',
  name: 'SAP Concur Delete List Item',
  description:
    'Delete a list item from all lists that contain it (DELETE /list/v4/items/{itemId}). This is not scoped to a single list, and all children of that list item are also deleted.',
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
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List item UUID',
    },
  },
  operation: {
    input: (params) => {
      const itemId = trimRequired(params.itemId, 'itemId')
      return {
        ...baseSapConcurInput(params),
        path: `/list/v4/items/${encodeURIComponent(itemId)}`,
        method: 'DELETE',
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description:
        'Empty body on success (HTTP 204 No Content). Error details when status is non-2xx',
    },
  },
}
