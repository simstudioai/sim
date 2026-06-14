import type {
  SalesforceDeleteLeadParams,
  SalesforceDeleteLeadResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceDeleteLeadTool: ToolConfig<
  SalesforceDeleteLeadParams,
  SalesforceDeleteLeadResponse
> = {
  id: 'salesforce_delete_lead',
  name: 'Delete Lead from Salesforce',
  description: 'Delete a lead',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Lead ID to delete (18-character string starting with 00Q)',
    },
  },

  request: {
    url: (params) => {
      const leadId = requireId(params.leadId, 'Lead ID')
      return `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Lead/${leadId}`
    },
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(extractErrorMessage(data, response.status, 'Failed to delete lead'))
    }
    return {
      success: true,
      output: {
        id: params?.leadId?.trim() || '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted lead data',
      properties: SOBJECT_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
