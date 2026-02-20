import type { JsmCreateRequestParams, JsmCreateRequestResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmCreateRequestTool: ToolConfig<JsmCreateRequestParams, JsmCreateRequestResponse> = {
  id: 'jsm_create_request',
  name: 'JSM Create Request',
  description: 'Create a new service request in Jira Service Management',
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
    serviceDeskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service Desk ID (e.g., "1", "2")',
    },
    requestTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request Type ID (e.g., "10", "15")',
    },
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Summary/title for the service request',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the service request',
    },
    raiseOnBehalfOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID of customer to raise request on behalf of',
    },
    requestFieldValues: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Request field values as key-value pairs (overrides summary/description if provided)',
    },
    requestParticipants: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated account IDs to add as request participants',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel the request originates from (e.g., portal, email)',
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
      serviceDeskId: params.serviceDeskId,
      requestTypeId: params.requestTypeId,
      summary: params.summary,
      description: params.description,
      raiseOnBehalfOf: params.raiseOnBehalfOf,
      requestFieldValues: params.requestFieldValues,
      requestParticipants: params.requestParticipants,
      channel: params.channel,
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
          success: false,
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
        success: false,
        url: '',
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueId: { type: 'string', description: 'Created request issue ID' },
    issueKey: { type: 'string', description: 'Created request issue key (e.g., SD-123)' },
    requestTypeId: { type: 'string', description: 'Request type ID' },
    serviceDeskId: { type: 'string', description: 'Service desk ID' },
    createdDate: {
      type: 'json',
      description: 'Creation date with iso8601, friendly, epochMillis',
      optional: true,
    },
    currentStatus: {
      type: 'json',
      description: 'Current status with status name and category',
      optional: true,
    },
    reporter: {
      type: 'json',
      description: 'Reporter user with accountId, displayName, emailAddress',
      optional: true,
    },
    success: { type: 'boolean', description: 'Whether the request was created successfully' },
    url: { type: 'string', description: 'URL to the created request' },
  },
}
