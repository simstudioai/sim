import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUpdateCustomFieldsParams,
} from '@/tools/helpscout/types'
import { CONVERSATION_CHANGE_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
  parseHelpScoutId,
  parseJsonParam,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

function parseCustomFields(value: unknown): Array<{ id: number; value: string }> {
  const parsed = parseJsonParam(value, 'customFields') ?? []
  if (!Array.isArray(parsed)) {
    throw new Error('customFields must be a JSON array of { "id": number, "value": string }')
  }
  return parsed.map((entry) => {
    const field = entry as { id?: unknown; value?: unknown }
    if (field.value === undefined || field.value === null) {
      throw new Error('Every custom field needs a value; use an empty string to clear one')
    }
    return { id: parseHelpScoutId(field.id, 'customFields[].id'), value: String(field.value) }
  })
}

export const helpScoutUpdateCustomFieldsTool: ToolConfig<
  HelpScoutUpdateCustomFieldsParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_update_custom_fields',
  name: 'Help Scout Update Custom Fields',
  description:
    'Replace the custom field values on a Help Scout conversation. Fields left out are cleared, except Help Scout-managed fields such as Topic and Sentiment, which keep their value. Dropdowns take the option ID and dates use YYYY-MM-DD.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    customFields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Every custom field value the conversation should have, as [{"id": 104, "value": "168"}]. Use List Custom Fields for IDs and dropdown option IDs.',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/fields'),
    method: 'PUT',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({ fields: parseCustomFields(params.customFields) }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
