import type {
  JotformFormPropertiesResponse,
  JotformUpdateFormPropertiesParams,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  isRecord,
  parseJotformResponse,
  requireValue,
  toJsonObject,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const updateFormPropertiesTool: ToolConfig<
  JotformUpdateFormPropertiesParams,
  JotformFormPropertiesResponse
> = {
  id: 'jotform_update_form_properties',
  name: 'Jotform Update Form Properties',
  description:
    'Update form settings such as the thank-you redirect, submission limit, width, or styles. Only the supplied keys change.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the form to update',
    },
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Properties to set, e.g. { "thankurl": "https://example.com/thanks", "activeRedirect": "thankurl", "formWidth": "650" }',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/properties`
      ).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    /**
     * The PUT endpoint reads a `properties` envelope, not the bare property map —
     * `{"properties":{"formWidth":"650"}}`. Posting the map unwrapped is accepted
     * with a 200 and changes nothing.
     */
    body: (params) => {
      const properties = toJsonObject(params.properties, 'properties')
      if (Object.keys(properties).length === 0) {
        throw new Error('properties must contain at least one key to update.')
      }
      return { properties }
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Update Form Properties')

    return {
      success: true,
      output: {
        properties: isRecord(envelope.content) ? envelope.content : {},
      },
    }
  },

  outputs: {
    properties: {
      type: 'json',
      description: 'The property keys that were edited, with their new values',
    },
  },
}
