import type { SapConcurProxyResponse, UpdateUserParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  scimUserOutputProperties,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const updateUserTool: ToolConfig<UpdateUserParams, SapConcurProxyResponse> = {
  id: 'sap_concur_update_user',
  name: 'SAP Concur Update User',
  description: 'Patch a user identity (PATCH /profile/identity/v4.1/Users/{id}).',
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
      description: 'User UUID to update',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'SCIM PATCH operations payload ({ schemas, Operations: [...] })',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userUuid = trimRequired(params.userUuid, 'userUuid')
      return {
        ...baseProxyBody(params),
        path: `/profile/identity/v4.1/Users/${encodeURIComponent(userUuid)}`,
        method: 'PATCH',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Updated SCIM User payload',
      properties: scimUserOutputProperties,
    },
  },
}
