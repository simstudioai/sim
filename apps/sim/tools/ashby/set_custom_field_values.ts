import type { AshbyCustomField } from '@/tools/ashby/types'
import {
  ASHBY_ON_BEHALF_OF_PARAM,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CUSTOM_FIELDS_OUTPUT,
  mapCustomFieldOnObject,
  normalizeObjectType,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbySetCustomFieldValuesParams {
  apiKey: string
  onBehalfOfUserId?: string
  objectId: string
  objectType: string
  values: unknown
}

interface AshbySetCustomFieldValuesResponse extends ToolResponse {
  output: {
    customFields: AshbyCustomField[]
  }
}

export const setCustomFieldValuesTool: ToolConfig<
  AshbySetCustomFieldValuesParams,
  AshbySetCustomFieldValuesResponse
> = {
  id: 'ashby_set_custom_field_values',
  name: 'Ashby Set Custom Field Values',
  description:
    'Sets several custom field values on one Ashby Application, Candidate, Job, or Opening in a single call. Prefer this over repeated single-field writes to the same object - Ashby recommends it because concurrent single-field calls can race and overwrite each other. Requires the candidatesWrite permission.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    ...ASHBY_ON_BEHALF_OF_PARAM,
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'UUID of the object to set the fields on (application, candidate, job, or opening)',
    },
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of the object: Application, Candidate, Job, or Opening',
    },
    values: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of at least one { fieldId, fieldValue } pair. fieldId is a custom field definition UUID from List Custom Fields. fieldValue matches the field type: boolean, number, string, string array (MultiValueSelect), or an object for Currency, NumberRange, CompensationRange, and Location. Pass null as a fieldValue to clear that field.',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/customField.setValues',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey, params.onBehalfOfUserId),
    /** Ashby rejects an empty array; fail here with a message naming the field. */
    body: (params) => {
      if (!Array.isArray(params.values) || params.values.length === 0) {
        throw new Error(
          'Ashby custom field values must be a non-empty array of { fieldId, fieldValue } pairs.'
        )
      }
      return {
        objectId: params.objectId.trim(),
        objectType: normalizeObjectType(params.objectType),
        values: params.values,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to set custom field values'))
    }

    return {
      success: true,
      output: {
        customFields: (data.results ?? []).map(mapCustomFieldOnObject),
      },
    }
  },

  outputs: {
    customFields: {
      ...CUSTOM_FIELDS_OUTPUT,
      description: 'The custom fields as stored on the object after the write',
    },
  },
}
