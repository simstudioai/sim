import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUpdateConversationStatusParams,
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

const STATUSES = new Set(['active', 'open', 'pending', 'closed', 'spam'])

export const helpScoutUpdateConversationStatusTool: ToolConfig<
  HelpScoutUpdateConversationStatusParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_update_conversation_status',
  name: 'Help Scout Update Conversation Status',
  description:
    'Change the status of a Help Scout conversation to active, open, pending, closed, or spam.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'active, open, pending, closed, or spam',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      const status = params.status?.trim() ?? ''
      if (!STATUSES.has(status))
        throw new Error('status must be active, open, pending, closed, or spam')
      return { op: 'replace', path: '/status', value: status }
    },
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
