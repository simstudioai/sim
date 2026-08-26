import type {
  SalesforceUpdateCaseParams,
  SalesforceUpdateCaseResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const salesforceUpdateCaseTool: ToolConfig<
  SalesforceUpdateCaseParams,
  SalesforceUpdateCaseResponse
> = {
  id: 'salesforce_update_case',
  name: 'Update Case in Salesforce',
  description: 'Update an existing case',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    caseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Case ID to update (18-character string starting with 500)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case subject',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status (e.g., New, Working, Escalated, Closed)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority (e.g., Low, Medium, High)',
    },
    origin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Origin (e.g., Phone, Email, Web)',
    },
    contactId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Salesforce Contact ID (18-character string starting with 003)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Salesforce Account ID (18-character string starting with 001)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case description',
    },
  },

  request: {
    url: (params) => {
      const caseId = requireId(params.caseId, 'Case ID')
      return `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Case/${safeUrlPathSegment(caseId, 'caseId')}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.subject) body.Subject = params.subject
      if (params.status) body.Status = params.status
      if (params.priority) body.Priority = params.priority
      if (params.origin) body.Origin = params.origin
      if (params.contactId) body.ContactId = params.contactId.trim()
      if (params.accountId) body.AccountId = params.accountId.trim()
      if (params.description) body.Description = params.description
      return body
    },
  },

  /**
   * Non-2xx responses never reach here: the tool executor inspects
   * `response.ok` and throws before `transformResponse` runs (see
   * `tools/index.ts` `isErrorResponse`, and `tools/utils.server.ts`), so this
   * only ever observes a successful PATCH. Salesforce returns 204 with an empty
   * body on success, hence the echoed id rather than a parsed record.
   */
  transformResponse: async (_response, params?) => {
    return {
      success: true,
      output: {
        id: params?.caseId?.trim() || '',
        updated: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated case data',
      properties: SOBJECT_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
