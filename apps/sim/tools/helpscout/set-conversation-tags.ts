import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutSetConversationTagsParams,
} from '@/tools/helpscout/types'
import { CONVERSATION_CHANGE_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
  parseJsonParam,
  toStringList,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

/** An empty list removes every tag, so clearing takes an explicit `[]` and never an omitted value. */
function parseTags(value: unknown): string[] {
  const parsed =
    typeof value === 'string' && value.trim().startsWith('[')
      ? parseJsonParam(value, 'tags')
      : value
  const tags = toStringList(parsed)
  if (tags.length === 0 && !Array.isArray(parsed))
    throw new Error('tags is empty; pass [] to remove every tag')
  return tags
}

export const helpScoutSetConversationTagsTool: ToolConfig<
  HelpScoutSetConversationTagsParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_set_conversation_tags',
  name: 'Help Scout Set Conversation Tags',
  description:
    'Replace the full tag list on a Help Scout conversation. Tags left out are removed, [] removes every tag, and unknown tags are created.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated tags the conversation should have, including any existing tags to keep. Pass [] to remove every tag.',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/tags'),
    method: 'PUT',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({ tags: parseTags(params.tags) }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
