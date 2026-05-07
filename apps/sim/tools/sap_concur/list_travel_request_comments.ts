import type {
  ListTravelRequestCommentsParams,
  SapConcurProxyResponse,
} from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listTravelRequestCommentsTool: ToolConfig<
  ListTravelRequestCommentsParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_list_travel_request_comments',
  name: 'SAP Concur List Travel Request Comments',
  description:
    'List comments on a travel request (GET /travelrequest/v4/requests/{requestUuid}/comments).',
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
      description: 'Travel request UUID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}/comments`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Array of comment entries',
      items: {
        type: 'json',
        properties: {
          author: {
            type: 'json',
            description: 'Comment author',
            optional: true,
            properties: {
              firstName: { type: 'string', description: 'Author first name', optional: true },
              lastName: { type: 'string', description: 'Author last name', optional: true },
            },
          },
          creationDateTime: {
            type: 'string',
            description: 'Comment creation timestamp (ISO 8601)',
            optional: true,
          },
          isLatest: {
            type: 'boolean',
            description: 'Whether this is the latest comment',
            optional: true,
          },
          value: { type: 'string', description: 'Comment text', optional: true },
        },
      },
    },
  },
}
