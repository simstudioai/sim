import type { DeleteTravelRequestParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteTravelRequestTool: InternalToolConfig<
  DeleteTravelRequestParams,
  SapConcurResponse
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
      description:
        'Concur user UUID of the Request owner — required when using the default `client_credentials` (company) grant; omitting it returns 400 `missingRequiredParam`.',
    },
  },
  operation: {
    input: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      const query: Record<string, string> = {}
      const userId = params.userId?.trim()
      if (userId) query.userId = userId
      return {
        ...baseSapConcurInput(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}`,
        method: 'DELETE',
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'boolean',
      description: 'Concur delete response body — literally true on 200 OK',
    },
  },
}
