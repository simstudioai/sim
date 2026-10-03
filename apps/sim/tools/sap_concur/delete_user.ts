import type { DeleteUserParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteUserTool: InternalToolConfig<DeleteUserParams, SapConcurResponse> = {
  id: 'sap_concur_delete_user',
  name: 'SAP Concur Delete User',
  description:
    'Hard delete a user identity (DELETE /profile/identity/v4.1/Users/{id}). Not recommended: SAP restricts hard delete to users with no transaction history and governs it by the Concur Data Retention policy. To deactivate a user instead, use SAP Concur Update User with a PATCH replacing active with false.',
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
    userUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User UUID to delete',
    },
  },
  operation: {
    input: (params) => {
      const userUuid = trimRequired(params.userUuid, 'userUuid')
      return {
        ...baseSapConcurInput(params),
        path: `/profile/identity/v4.1/Users/${encodeURIComponent(userUuid)}`,
        method: 'DELETE',
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Deletion response — empty body on HTTP 204 No Content',
    },
  },
}
