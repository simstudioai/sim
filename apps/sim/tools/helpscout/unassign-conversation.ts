import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUnassignConversationParams,
} from '@/tools/helpscout/types'
import { CONVERSATION_CHANGE_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutUnassignConversationTool: ToolConfig<
  HelpScoutUnassignConversationParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_unassign_conversation',
  name: 'Help Scout Unassign Conversation',
  description: 'Remove the assignee from a Help Scout conversation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: () => ({ op: 'remove', path: '/assignTo' }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
