import { createLogger } from '@sim/logger'
import type {
  SalesforceDeleteCustomFieldParams,
  SalesforceDeleteCustomFieldResponse,
} from '@/tools/salesforce/types'
import { CUSTOM_FIELD_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceDeleteCustomField')

/**
 * Delete a custom field via the Tooling API. Deleting a field removes its data;
 * the field is moved to the org's recycle bin. Retrieve the field Id with the
 * Tooling Query tool.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export const salesforceDeleteCustomFieldTool: ToolConfig<
  SalesforceDeleteCustomFieldParams,
  SalesforceDeleteCustomFieldResponse
> = {
  id: 'salesforce_delete_custom_field',
  name: 'Delete Custom Field in Salesforce',
  description: 'Delete a custom field from a Salesforce object using the Tooling API',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Tooling API Id of the custom field to delete (find it via the Tooling Query tool)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const fieldId = requireId(params.fieldId, 'Field ID')
      return `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField/${fieldId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to delete custom field in Salesforce'
      )
      logger.error('Failed to delete custom field', { status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        id: params?.fieldId?.trim() ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted custom field metadata',
      properties: CUSTOM_FIELD_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
