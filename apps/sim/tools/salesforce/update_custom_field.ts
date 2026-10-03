import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  SalesforceUpdateCustomFieldParams,
  SalesforceUpdateCustomFieldResponse,
} from '@/tools/salesforce/types'
import { CUSTOM_FIELD_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Update an existing custom field via the Tooling API.
 *
 * Updates a field's attributes (label, length, help text, required, picklist
 * values, etc.) while keeping its existing data type — changing a field's type
 * is a separate, conversion-driven operation in Salesforce and is intentionally
 * out of scope here.
 *
 * The Tooling API PATCH replaces the field's entire `Metadata` compound, so a
 * naive partial PATCH would wipe any property the caller omits. To avoid that,
 * this tool performs a read-modify-write in one registered operation: it GETs the
 * field's current metadata, overlays only the provided changes, then PATCHes the
 * merged result. Unspecified properties (type, length, etc.) are preserved.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customfield.htm
 */

export const salesforceUpdateCustomFieldTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
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
