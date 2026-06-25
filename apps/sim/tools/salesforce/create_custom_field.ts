import { createLogger } from '@sim/logger'
import type {
  SalesforceCreateCustomFieldParams,
  SalesforceCreateCustomFieldResponse,
} from '@/tools/salesforce/types'
import { CUSTOM_FIELD_CREATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import {
  buildCustomFieldMetadata,
  extractErrorMessage,
  getInstanceUrl,
  requireId,
  toCustomApiName,
} from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceCreateCustomField')

/**
 * Create a custom field on a Salesforce object (standard or custom) via the
 * Tooling API. This is a schema/metadata change — distinct from record CRUD —
 * and requires the user to have the "Customize Application" permission.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export const salesforceCreateCustomFieldTool: ToolConfig<
  SalesforceCreateCustomFieldParams,
  SalesforceCreateCustomFieldResponse
> = {
  id: 'salesforce_create_custom_field',
  name: 'Create Custom Field in Salesforce',
  description: 'Create a custom field on a Salesforce object (e.g., Account) using the Tooling API',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'API name of the object to add the field to (e.g., Account, Contact, Lead, MyObject__c)',
    },
    fieldName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'API name of the new field; the __c suffix is added automatically (e.g., Region)',
    },
    label: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display label shown in the UI (defaults to the field name when omitted)',
    },
    fieldType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Field data type: Text, TextArea, LongTextArea, Html, Number, Currency, Percent, Checkbox, Date, DateTime, Time, Phone, Email, Url, Picklist, or MultiselectPicklist',
    },
    length: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum length for Text (1-255), LongTextArea, Html, or MultiselectPicklist fields',
    },
    precision: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total number of digits for Number, Currency, or Percent fields (1-18)',
    },
    scale: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of digits to the right of the decimal for numeric fields',
    },
    visibleLines: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of visible lines for LongTextArea, Html, or MultiselectPicklist fields',
    },
    required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field is required on record create/edit',
    },
    unique: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field enforces unique values',
    },
    externalId: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the field is an external ID (for Text, Number, or Email fields)',
    },
    defaultValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default value; for Checkbox fields use true or false',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal description of the field',
    },
    inlineHelpText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Help text shown next to the field in the UI',
    },
    picklistValues: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated values for Picklist or MultiselectPicklist fields',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const objectName = requireId(params.objectName, 'Object Name')
      const fieldApiName = toCustomApiName(params.fieldName, 'Field Name')
      const fallbackLabel = fieldApiName.replace(/__c$/, '').replace(/_/g, ' ')
      return {
        FullName: `${objectName}.${fieldApiName}`,
        Metadata: buildCustomFieldMetadata(params, fallbackLabel),
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok || data?.success === false) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to create custom field in Salesforce'
      )
      logger.error('Failed to create custom field', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const objectName = params?.objectName?.trim() ?? ''
    const fieldApiName = params?.fieldName ? toCustomApiName(params.fieldName, 'Field Name') : ''

    return {
      success: true,
      output: {
        id: data.id,
        fullName: objectName && fieldApiName ? `${objectName}.${fieldApiName}` : '',
        success: data.success === true,
        created: data.success === true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created custom field metadata',
      properties: CUSTOM_FIELD_CREATE_OUTPUT_PROPERTIES,
    },
  },
}
