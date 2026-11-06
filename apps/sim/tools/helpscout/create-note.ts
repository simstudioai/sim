import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutCreateNoteParams,
  HelpScoutCreateThreadResponse,
} from '@/tools/helpscout/types'
import { CREATED_THREAD_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  ACTING_USER_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationUrl,
  parseHelpScoutId,
  parseOptionalHelpScoutId,
  parseThreadStatus,
  readResourceId,
  THREAD_STATUS_PARAM,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutCreateNoteTool: ToolConfig<
  HelpScoutCreateNoteParams,
  HelpScoutCreateThreadResponse
> = {
  id: 'helpscout_create_note',
  name: 'Help Scout Add Note',
  description: 'Add an internal note to a Help Scout conversation. Customers never see notes.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Note text',
    },
    status: THREAD_STATUS_PARAM,
    userId: ACTING_USER_PARAM,
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/notes'),
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      if (!params.text?.trim()) throw new Error('text is required')
      const status = parseThreadStatus(params.status)
      const userId = parseOptionalHelpScoutId(params.userId, 'userId')
      return {
        text: params.text,
        ...(status ? { status } : {}),
        ...(userId !== undefined ? { user: userId } : {}),
      }
    },
  },
  transformResponse: async (response, params) => ({
    success: true,
    output: {
      conversationId: params ? parseHelpScoutId(params.conversationId, 'conversationId') : null,
      threadId: readResourceId(response),
    },
  }),
  outputs: CREATED_THREAD_OUTPUTS,
}
