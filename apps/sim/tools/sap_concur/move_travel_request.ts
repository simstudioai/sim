import type { MoveTravelRequestParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const moveTravelRequestTool: ToolConfig<MoveTravelRequestParams, SapConcurProxyResponse> = {
  id: 'sap_concur_move_travel_request',
  name: 'SAP Concur Move Travel Request',
  description:
    'Move a travel request through workflow (POST /travelrequest/v4/requests/{requestUuid}/{action}). Valid actions: submit, recall, cancel, approve, sendback, close, reopen.',
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
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow action: submit, recall, cancel, approve, sendback, close, reopen',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Concur user UUID — required when impersonating another user',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional payload (e.g., { "comment": "..." })',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const requestUuid = trimRequired(params.requestUuid, 'requestUuid')
      const action = trimRequired(params.action, 'action')
      const query: Record<string, string> = {}
      if (params.userId) query.userId = params.userId
      return {
        ...baseProxyBody(params),
        path: `/travelrequest/v4/requests/${encodeURIComponent(requestUuid)}/${encodeURIComponent(action)}`,
        method: 'POST',
        body: params.body ?? {},
        query: Object.keys(query).length > 0 ? query : undefined,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Workflow transition response payload',
      properties: {
        id: { type: 'string', description: 'Travel request UUID', optional: true },
        href: { type: 'string', description: 'Resource hyperlink', optional: true },
        approvalStatus: {
          type: 'json',
          description: 'Approval status after the workflow transition',
          optional: true,
          properties: {
            code: {
              type: 'string',
              description: 'Status code (NOT_SUBMITTED, SUBMITTED, APPROVED, CANCELED, SENTBACK)',
              optional: true,
            },
            name: { type: 'string', description: 'Localized status name', optional: true },
          },
        },
        approver: {
          type: 'json',
          description: 'Approver assigned after the transition',
          optional: true,
          properties: {
            id: { type: 'string', description: 'User UUID', optional: true },
            firstName: { type: 'string', description: 'Approver first name', optional: true },
            lastName: { type: 'string', description: 'Approver last name', optional: true },
          },
        },
        operations: {
          type: 'array',
          description: 'Available follow-up workflow actions',
          optional: true,
          items: {
            type: 'json',
            properties: {
              rel: { type: 'string', description: 'Link relation', optional: true },
              href: { type: 'string', description: 'Link target', optional: true },
              method: { type: 'string', description: 'HTTP method', optional: true },
              name: { type: 'string', description: 'Link name', optional: true },
            },
          },
        },
      },
    },
  },
}
