import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUnsnoozeConversationParams,
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

export const helpScoutUnsnoozeConversationTool: ToolConfig<
  HelpScoutUnsnoozeConversationParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_unsnooze_conversation',
  name: 'Help Scout Unsnooze Conversation',
  description:
    'End the snooze on a Help Scout conversation. It returns to its folder (Mine, Team, or Unassigned) and is reactivated if needed.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/snooze'),
    method: 'DELETE',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
