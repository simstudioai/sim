import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutGetConversationParams,
  HelpScoutGetConversationResponse,
} from '@/tools/helpscout/types'
import {
  HELPSCOUT_CONVERSATION_PROPERTIES,
  HELPSCOUT_THREAD_PROPERTIES,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  parseHelpScoutId,
  projectConversation,
  projectThread,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutGetConversationTool: ToolConfig<
  HelpScoutGetConversationParams,
  HelpScoutGetConversationResponse
> = {
  id: 'helpscout_get_conversation',
  name: 'Help Scout Get Conversation',
  description: 'Get a Help Scout conversation by ID, optionally with its threads.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation ID',
    },
    includeThreads: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the conversation threads (chat threads may be truncated)',
    },
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl(
        `/conversations/${parseHelpScoutId(params.conversationId, 'conversationId')}`,
        {
          embed: params.includeThreads ? 'threads' : undefined,
        }
      ),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        conversation: projectConversation(data),
        threads: embeddedList(data, 'threads').map(projectThread),
      },
    }
  },
  outputs: {
    conversation: {
      type: 'json',
      description: 'Conversation details',
      properties: HELPSCOUT_CONVERSATION_PROPERTIES,
    },
    threads: {
      type: 'array',
      description: 'Conversation threads (empty unless threads were included)',
      items: { type: 'object', properties: HELPSCOUT_THREAD_PROPERTIES },
    },
  },
}
