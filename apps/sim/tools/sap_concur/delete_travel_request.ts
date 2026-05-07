import type { DeleteTravelRequestParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteTravelRequestTool: ToolConfig<
  DeleteTravelRequestParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_delete_travel_request',
  name: 'SAP Concur Delete Travel Request',
  description: 'Delete a travel request (DELETE /travelrequest/v4/requests/{requestUuid}).',
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
    requestUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Travel request UUID to delete',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Concur user UUID — required when impersonating another user',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      const query: Record<string, string> = {}
      if (params.userId) query.userId = params.userId
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}`,
        method: 'DELETE',
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Concur delete response payload (boolean true on 200 OK)',
      properties: {},
    },
  },
}
