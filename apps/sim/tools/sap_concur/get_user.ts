import type { GetUserParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  scimUserOutputProperties,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<GetUserParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_user',
  name: 'SAP Concur Get User',
  description: 'Get a single user by UUID (GET /profile/identity/v4.1/Users/{id}).',
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
      description: 'User UUID',
    },
    attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated SCIM attributes to include in the response',
    },
    excludedAttributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated SCIM attributes to exclude from the response',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const userUuid = trimRequired(params.userUuid, 'userUuid')
      const query: Record<string, string> = {}
      if (params.attributes?.trim()) query.attributes = params.attributes.trim()
      if (params.excludedAttributes?.trim())
        query.excludedAttributes = params.excludedAttributes.trim()
      return {
        ...baseProxyBody(params),
        path: `/profile/identity/v4.1/Users/${encodeURIComponent(userUuid)}`,
        method: 'GET',
        ...(Object.keys(query).length > 0 ? { query } : {}),
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'SCIM User identity payload',
      properties: scimUserOutputProperties,
    },
  },
}
