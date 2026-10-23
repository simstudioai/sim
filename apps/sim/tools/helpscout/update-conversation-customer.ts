import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUpdateConversationCustomerParams,
} from '@/tools/helpscout/types'
import { CONVERSATION_CHANGE_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
  parseHelpScoutId,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutUpdateConversationCustomerTool: ToolConfig<
  HelpScoutUpdateConversationCustomerParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_update_conversation_customer',
  name: 'Help Scout Change Conversation Customer',
  description: 'Change the primary customer of a Help Scout conversation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the customer to make primary',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({
      op: 'replace',
      path: '/primaryCustomer.id',
      value: parseHelpScoutId(params.customerId, 'customerId'),
    }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
