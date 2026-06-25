import { createLogger } from '@sim/logger'
import type {
  SalesforceUpdateCustomFieldParams,
  SalesforceUpdateCustomFieldResponse,
} from '@/tools/salesforce/types'
import { CUSTOM_FIELD_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import {
  extractErrorMessage,
  getInstanceUrl,
  mergeCustomFieldMetadata,
  requireId,
} from '@/tools/salesforce/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('SalesforceUpdateCustomField')

/**
 * Update an existing custom field via the Tooling API.
 *
 * The Tooling API PATCH replaces the field's entire `Metadata` compound, so a
 * naive partial PATCH would wipe any property the caller omits. To avoid that,
 * this tool performs a read-modify-write in `directExecution`: it GETs the
 * field's current metadata, overlays only the provided changes, then PATCHes the
 * merged result. Unspecified properties (label, length, etc.) are preserved.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */
export const salesforceUpdateCustomFieldTool: ToolConfig<
  SalesforceUpdateCustomFieldParams,
  SalesforceUpdateCustomFieldResponse
> = {
  id: 'salesforce_update_custom_field',
  name: 'Update Custom Field in Salesforce',
  description: 'Update an existing custom field on a Salesforce object using the Tooling API',
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
        'Tooling API Id of the custom field to update (find it via the Tooling Query tool)',
    },
    fieldType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Only provide to change the field's data type (e.g., Text, Number, Picklist); omit to keep the existing type",
    },
    label: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display label shown in the UI',
    },
    length: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum length for Text, LongTextArea, Html, or MultiselectPicklist fields',
    },
    precision: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total number of digits for Number, Currency, or Percent fields',
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
      description: 'Whether the field is an external ID',
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
      description:
        'Comma-separated values to add to a Picklist or MultiselectPicklist field (existing values are kept)',
    },
  },

  /**
   * Read-modify-write so omitted properties are preserved rather than reset by
   * the Tooling API's full-metadata PATCH semantics.
   */
  directExecution: async (params): Promise<ToolResponse> => {
    const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
    const fieldId = requireId(params.fieldId, 'Field ID')
    const url = `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField/${fieldId}`
    const headers = {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }

    const readResponse = await fetch(url, { headers })
    const existing = await readResponse.json().catch(() => ({}))
    if (!readResponse.ok) {
      const errorMessage = extractErrorMessage(
        existing,
        readResponse.status,
        'Failed to load custom field for update'
      )
      logger.error('Failed to read custom field metadata', { status: readResponse.status })
      throw new Error(errorMessage)
    }

    const metadata = mergeCustomFieldMetadata(existing?.Metadata, params)

    const patchResponse = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ Metadata: metadata }),
    })
    if (!patchResponse.ok) {
      const errorData = await patchResponse.json().catch(() => ({}))
      const errorMessage = extractErrorMessage(
        errorData,
        patchResponse.status,
        'Failed to update custom field in Salesforce'
      )
      logger.error('Failed to update custom field', { status: patchResponse.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        id: fieldId,
        updated: true,
      },
    }
  },

  /**
   * Declarative fallback. `directExecution` is the authoritative path and handles
   * the read-modify-write; this is only used if direct execution is bypassed.
   */
  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const fieldId = requireId(params.fieldId, 'Field ID')
      return `${instanceUrl}/services/data/v59.0/tooling/sobjects/CustomField/${fieldId}`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => ({ Metadata: mergeCustomFieldMetadata(undefined, params) }),
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to update custom field in Salesforce'
      )
      logger.error('Failed to update custom field', { status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        id: params?.fieldId?.trim() ?? '',
        updated: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated custom field metadata',
      properties: CUSTOM_FIELD_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
