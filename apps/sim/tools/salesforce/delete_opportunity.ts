import type {
  SalesforceDeleteOpportunityParams,
  SalesforceDeleteOpportunityResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceDeleteOpportunityTool: ToolConfig<
  SalesforceDeleteOpportunityParams,
  SalesforceDeleteOpportunityResponse
> = {
  id: 'salesforce_delete_opportunity',
  name: 'Delete Opportunity from Salesforce',
  description: 'Delete an opportunity',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Opportunity ID to delete (18-character string starting with 006)',
    },
  },

  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Opportunity/${params.opportunityId}`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete opportunity')
    }
    return {
      success: true,
      output: {
        id: params?.opportunityId || '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted opportunity data',
      properties: SOBJECT_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
