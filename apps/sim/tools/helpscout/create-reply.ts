import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutCreateReplyParams,
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
  toStringList,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutCreateReplyTool: ToolConfig<
  HelpScoutCreateReplyParams,
  HelpScoutCreateThreadResponse
> = {
  id: 'helpscout_create_reply',
  name: 'Help Scout Reply to Conversation',
  description: 'Send a reply to the customer on a Help Scout conversation, or save it as a draft.',
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
      description: 'ID of the customer being replied to (the primary customer ID)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reply text',
    },
    draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Save the reply as a draft instead of sending it',
    },
    status: THREAD_STATUS_PARAM,
    assignTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User or team ID to assign once the reply is sent',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated CC email addresses',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated BCC email addresses',
    },
    userId: ACTING_USER_PARAM,
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/reply'),
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      if (!params.text?.trim()) throw new Error('text is required')
      const status = parseThreadStatus(params.status)
      const assignTo = parseOptionalHelpScoutId(params.assignTo, 'assignTo')
      const userId = parseOptionalHelpScoutId(params.userId, 'userId')
      const cc = toStringList(params.cc)
      const bcc = toStringList(params.bcc)
      return {
        customer: { id: parseHelpScoutId(params.customerId, 'customerId') },
        text: params.text,
        ...(params.draft !== undefined ? { draft: params.draft } : {}),
        ...(status ? { status } : {}),
        ...(assignTo !== undefined ? { assignTo } : {}),
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
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
