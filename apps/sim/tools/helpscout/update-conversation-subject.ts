import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutUpdateConversationSubjectParams,
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

export const helpScoutUpdateConversationSubjectTool: ToolConfig<
  HelpScoutUpdateConversationSubjectParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_update_conversation_subject',
  name: 'Help Scout Update Conversation Subject',
  description: 'Change the subject of a Help Scout conversation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New subject',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId),
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      if (!params.subject?.trim()) throw new Error('subject is required')
      return { op: 'replace', path: '/subject', value: params.subject }
    },
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
