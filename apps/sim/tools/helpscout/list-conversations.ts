import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListConversationsParams,
  HelpScoutListConversationsResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_CONVERSATION_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseOptionalHelpScoutId,
  projectConversation,
  projectPage,
  toStringList,
  validateConversationNumber,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListConversationsTool: ToolConfig<
  HelpScoutListConversationsParams,
  HelpScoutListConversationsResponse
> = {
  id: 'helpscout_list_conversations',
  name: 'Help Scout List Conversations',
  description:
    'List and search Help Scout conversations by inbox, folder, status, tag, assignee, or search query. Returns 25 conversations per page.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    mailboxId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inbox ID to filter by; comma-separate several IDs',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder ID to filter by',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'active, open, pending, closed, spam, or all (defaults to active)',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag to filter by; comma-separate several tags',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the assignee to filter by',
    },
    modifiedSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only conversations modified after this time (e.g. 2024-05-04T12:00:03Z)',
    },
    number: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation number to look up',
    },
    sortField: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'createdAt, customerEmail, customerName, mailboxid, modifiedAt, number, score, status, subject, or waitingSince',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'asc or desc (defaults to desc)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced search query, e.g. (email:"jane@example.com" AND tag:"vip")',
    },
    page: PAGE_PARAM,
  },
  request: {
    url: (params) => {
      const mailboxIds = toStringList(params.mailboxId).map((id) =>
        parseOptionalHelpScoutId(id, 'mailboxId')
      )
      return buildHelpScoutUrl('/conversations', {
        mailbox: mailboxIds.length > 0 ? mailboxIds.join(',') : undefined,
        folder: parseOptionalHelpScoutId(params.folderId, 'folderId'),
        status: params.status?.trim(),
        tag: toStringList(params.tag).join(',') || undefined,
        assigned_to: parseOptionalHelpScoutId(params.assignedTo, 'assignedTo'),
        modifiedSince: params.modifiedSince?.trim(),
        number: validateConversationNumber(params.number),
        sortField: params.sortField?.trim(),
        sortOrder: params.sortOrder?.trim(),
        query: params.query?.trim(),
        page: validatePage(params.page),
      })
    },
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        conversations: embeddedList(data, 'conversations').map(projectConversation),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    conversations: {
      type: 'array',
      description: 'Conversations on this page',
      items: { type: 'object', properties: HELPSCOUT_CONVERSATION_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
