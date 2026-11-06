import { toArray } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListSavedRepliesParams,
  HelpScoutListSavedRepliesResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_SAVED_REPLY_SUMMARY_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  parseHelpScoutId,
  projectSavedReplySummary,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListSavedRepliesTool: ToolConfig<
  HelpScoutListSavedRepliesParams,
  HelpScoutListSavedRepliesResponse
> = {
  id: 'helpscout_list_saved_replies',
  name: 'Help Scout List Saved Replies',
  description:
    'List the saved replies (canned responses) in a Help Scout inbox with a preview of each.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    mailboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inbox ID',
    },
    includeChatReplies: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include chat-only saved replies (defaults to false)',
    },
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl(
        `/mailboxes/${parseHelpScoutId(params.mailboxId, 'mailboxId')}/saved-replies`,
        { includeChatReplies: params.includeChatReplies ? 'true' : undefined }
      ),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { savedReplies: toArray(await response.json()).map(projectSavedReplySummary) },
  }),
  outputs: {
    savedReplies: {
      type: 'array',
      description: 'Saved replies in the inbox',
      items: { type: 'object', properties: HELPSCOUT_SAVED_REPLY_SUMMARY_PROPERTIES },
    },
  },
}
