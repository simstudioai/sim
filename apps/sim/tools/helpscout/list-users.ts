import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { HelpScoutListUsersParams, HelpScoutListUsersResponse } from '@/tools/helpscout/types'
import { HELPSCOUT_USER_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseOptionalHelpScoutId,
  projectPage,
  projectUser,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListUsersTool: ToolConfig<
  HelpScoutListUsersParams,
  HelpScoutListUsersResponse
> = {
  id: 'helpscout_list_users',
  name: 'Help Scout List Users',
  description: 'List Help Scout users, optionally filtered by exact email or by inbox.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact email address to look up',
    },
    mailboxId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inbox ID to filter by',
    },
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl('/users', {
        email: params.email?.trim(),
        mailbox: parseOptionalHelpScoutId(params.mailboxId, 'mailboxId'),
        page: validatePage(params.page),
      }),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        users: embeddedList(data, 'users').map(projectUser),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'Users on this page',
      items: { type: 'object', properties: HELPSCOUT_USER_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
