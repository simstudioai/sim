import type { AshbyCustomField } from '@/tools/ashby/types'
import {
  ASHBY_ON_BEHALF_OF_PARAM,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CUSTOM_FIELD_ON_OBJECT_OUTPUT,
  mapCustomFieldOnObject,
  normalizeObjectType,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbySetCustomFieldValueParams {
  apiKey: string
  onBehalfOfUserId?: string
  objectId: string
  objectType: string
  fieldId: string
  fieldValue: unknown
}

interface AshbySetCustomFieldValueResponse extends ToolResponse {
  output: {
    customField: AshbyCustomField
  }
}

export const setCustomFieldValueTool: ToolConfig<
  AshbySetCustomFieldValueParams,
  AshbySetCustomFieldValueResponse
> = {
  id: 'ashby_set_custom_field_value',
  name: 'Ashby Set Custom Field Value',
  description:
    'Sets the value of a single custom field on an Ashby Application, Candidate, Job, or Opening. Custom fields are the only way to annotate a job or req, since Ashby has no job notes and no job tags. Requires the candidatesWrite permission.',
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
        'UUID of the object to set the field on (application, candidate, job, or opening)',
    },
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of the object: Application, Candidate, Job, or Opening',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'UUID of the custom field definition to set, as returned by List Custom Fields. This is the field definition ID, not the ID of a value already on the object.',
    },
    /**
     * Not marked required even though Ashby always expects the key: the shared
     * post-merge validator rejects a required `user-or-llm` param whose value is
     * `null`, and `null` is exactly how a custom field is cleared. The block
     * keeps its own required marker on the subblock, so a blank field is still
     * caught in the editor. See `validateRequiredParametersAfterMerge`.
     */
    fieldValue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Value to write, matching the field type: boolean, number, string (String, LongText, Date, Url, or a ValueSelect option), string array (MultiValueSelect), or an object for Currency ({value, currencyCode}), NumberRange ({type, minValue, maxValue}), CompensationRange, and Location ({country, region, city}). Pass null to clear the value, which makes the annotation reversible.',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/customField.setValue',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey, params.onBehalfOfUserId),
    /**
     * `null` clears the field, so an omitted or blank value must not be allowed
     * to reach Ashby as one - that would turn a dropped variable, an unresolved
     * block reference, or a model call that forgot the argument into silent
     * data loss. Clearing has to be asked for explicitly.
     */
    body: (params) => {
      const isBlank =
        params.fieldValue === undefined ||
        (typeof params.fieldValue === 'string' && params.fieldValue.trim() === '')
      if (isBlank) {
        throw new Error(
          'Ashby custom field value is required. Pass null to clear the field, or provide a value to set.'
        )
      }
      return {
        objectId: params.objectId.trim(),
        objectType: normalizeObjectType(params.objectType),
        fieldId: params.fieldId.trim(),
        fieldValue: params.fieldValue,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to set custom field value'))
    }

    return {
      success: true,
      output: {
        customField: mapCustomFieldOnObject(data.results),
      },
    }
  },

  outputs: {
    customField: {
      type: 'object',
      description: 'The custom field as stored on the object after the write',
      properties: CUSTOM_FIELD_ON_OBJECT_OUTPUT,
    },
  },
}
