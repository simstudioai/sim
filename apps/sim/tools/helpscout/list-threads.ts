import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListThreadsParams,
  HelpScoutListThreadsResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_THREAD_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  CONVERSATION_ID_PARAM,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseHelpScoutId,
  projectPage,
  projectThread,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListThreadsTool: ToolConfig<
  HelpScoutListThreadsParams,
  HelpScoutListThreadsResponse
> = {
  id: 'helpscout_list_threads',
  name: 'Help Scout List Threads',
  description:
    'List the threads (customer messages, replies, notes, and activity) of a Help Scout conversation, newest first, including full chat threads.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl(
        `/conversations/${parseHelpScoutId(params.conversationId, 'conversationId')}/threads`,
        { page: validatePage(params.page) }
      ),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        threads: embeddedList(data, 'threads').map(projectThread),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    threads: {
      type: 'array',
      description: 'Threads on this page, newest first',
      items: { type: 'object', properties: HELPSCOUT_THREAD_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
