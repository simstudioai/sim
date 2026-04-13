import type {
  JsmGetRequestTypeFieldsParams,
  JsmGetRequestTypeFieldsResponse,
} from '@/tools/jsm/types'
import { REQUEST_TYPE_FIELD_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetRequestTypeFieldsTool: ToolConfig<
  JsmGetRequestTypeFieldsParams,
  JsmGetRequestTypeFieldsResponse
> = {
  id: 'jsm_get_request_type_fields',
  name: 'JSM Get Request Type Fields',
  description:
    'Get the fields required to create a request of a specific type in Jira Service Management',
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
  },

  request: {
    url: '/api/tools/jsm/requesttypefields',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          serviceDeskId: '',
          requestTypeId: '',
          canAddRequestParticipants: false,
          canRaiseOnBehalfOf: false,
          requestTypeFields: [],
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
        serviceDeskId: '',
        requestTypeId: '',
        canAddRequestParticipants: false,
        canRaiseOnBehalfOf: false,
        requestTypeFields: [],
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    serviceDeskId: { type: 'string', description: 'Service desk ID' },
    requestTypeId: { type: 'string', description: 'Request type ID' },
    canAddRequestParticipants: {
      type: 'boolean',
      description: 'Whether participants can be added to requests of this type',
    },
    canRaiseOnBehalfOf: {
      type: 'boolean',
      description: 'Whether requests can be raised on behalf of another user',
    },
    requestTypeFields: {
      type: 'array',
      description: 'List of fields for this request type',
      items: {
        type: 'object',
        properties: REQUEST_TYPE_FIELD_PROPERTIES,
      },
    },
  },
}
