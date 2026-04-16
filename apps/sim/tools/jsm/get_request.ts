import type { JsmGetRequestParams, JsmGetRequestResponse } from '@/tools/jsm/types'
import {
  REQUEST_FIELD_VALUE_PROPERTIES,
  REQUEST_STATUS_PROPERTIES,
  USER_OUTPUT_PROPERTIES,
} from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetRequestTool: ToolConfig<JsmGetRequestParams, JsmGetRequestResponse> = {
  id: 'jsm_get_request',
  name: 'JSM Get Request',
  description: 'Get a single service request from Jira Service Management',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    issueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID or key (e.g., SD-123)',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated fields to expand: participant, status, sla, requestType, serviceDesk, attachment, comment, action',
    },
  },

  request: {
    url: '/api/tools/jsm/request',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      expand: params.expand,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          issueId: '',
          issueKey: '',
          requestTypeId: '',
          serviceDeskId: '',
          createdDate: null,
          currentStatus: null,
          reporter: null,
          requestFieldValues: [],
          url: '',
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        issueId: '',
        issueKey: '',
        requestTypeId: '',
        serviceDeskId: '',
        createdDate: null,
        currentStatus: null,
        reporter: null,
        requestFieldValues: [],
        url: '',
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueId: { type: 'string', description: 'Jira issue ID' },
    issueKey: { type: 'string', description: 'Issue key (e.g., SD-123)' },
    requestTypeId: { type: 'string', description: 'Request type ID' },
    serviceDeskId: { type: 'string', description: 'Service desk ID' },
    createdDate: {
      type: 'json',
      description: 'Creation date with iso8601, friendly, epochMillis',
      optional: true,
    },
    currentStatus: {
      type: 'object',
      description: 'Current request status',
      properties: REQUEST_STATUS_PROPERTIES,
      optional: true,
    },
    reporter: {
      type: 'object',
      description: 'Reporter user details',
      properties: USER_OUTPUT_PROPERTIES,
      optional: true,
    },
    requestFieldValues: {
      type: 'array',
      description: 'Request field values',
      items: {
        type: 'object',
        properties: REQUEST_FIELD_VALUE_PROPERTIES,
      },
    },
    url: { type: 'string', description: 'URL to the request' },
    request: {
      type: 'json',
      description: 'The service request object',
    },
  },
}
