import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutGetSavedReplyParams,
  HelpScoutGetSavedReplyResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_SAVED_REPLY_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
  projectSavedReply,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutGetSavedReplyTool: ToolConfig<
  HelpScoutGetSavedReplyParams,
  HelpScoutGetSavedReplyResponse
> = {
  id: 'helpscout_get_saved_reply',
  name: 'Help Scout Get Saved Reply',
  description: 'Get the full text of a Help Scout saved reply for email and chat.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    mailboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inbox ID the saved reply belongs to',
    },
    savedReplyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Saved reply ID',
    },
  },
  request: {
    url: (params) =>
      `${HELPSCOUT_API_BASE}/mailboxes/${parseHelpScoutId(params.mailboxId, 'mailboxId')}/saved-replies/${parseHelpScoutId(params.savedReplyId, 'savedReplyId')}`,
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { savedReply: projectSavedReply(await response.json()) },
  }),
  outputs: {
    savedReply: {
      type: 'json',
      description: 'Saved reply',
      properties: HELPSCOUT_SAVED_REPLY_PROPERTIES,
    },
  },
}
