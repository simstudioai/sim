import type {
  JotformFormPropertiesResponse,
  JotformGetFormPropertiesParams,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  isRecord,
  parseJotformResponse,
  requireValue,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getFormPropertiesTool: ToolConfig<
  JotformGetFormPropertiesParams,
  JotformFormPropertiesResponse
> = {
  id: 'jotform_get_form_properties',
  name: 'Jotform Get Form Properties',
  description:
    'Get the settings of a form: layout, limits, redirect behavior, notification emails, and validation strings. Supply a property key to read just one.',
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
      description: 'ID of the form to read properties from',
    },
    propertyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Single property to read instead of the whole set, e.g. formWidth, thankurl, or activeRedirect',
    },
  },

  request: {
    url: (params) => {
      const formId = encodeURIComponent(requireValue(params.formId, 'formId'))
      const key = trimOrUndefined(params.propertyKey)
      const path = key
        ? `form/${formId}/properties/${encodeURIComponent(key)}`
        : `form/${formId}/properties`
      return buildJotformUrl(params, path).toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Form Properties')

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
      description:
        'Form properties keyed by property name. The set varies by form; documented keys include formWidth, labelWidth, activeRedirect, thankurl, expireDate, limitSubmission, styles, emails, and formStrings.',
    },
  },
}
