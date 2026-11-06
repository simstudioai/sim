import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutDeleteConversationParams,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutDeleteConversationTool: ToolConfig<
  HelpScoutDeleteConversationParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_delete_conversation',
  name: 'Help Scout Delete Conversation',
  description: 'Delete a Help Scout conversation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'DELETE',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: {
    conversationId: {
      type: 'number',
      description: 'ID of the deleted conversation',
      nullable: true,
    },
  },
}
