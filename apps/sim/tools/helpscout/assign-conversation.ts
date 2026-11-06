import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutAssignConversationParams,
  HelpScoutConversationChangeResponse,
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

export const helpScoutAssignConversationTool: ToolConfig<
  HelpScoutAssignConversationParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_assign_conversation',
  name: 'Help Scout Assign Conversation',
  description: 'Assign a Help Scout conversation to a user or team.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    assignTo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User or team ID to assign the conversation to',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({
      op: 'replace',
      path: '/assignTo',
      value: parseHelpScoutId(params.assignTo, 'assignTo'),
    }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
