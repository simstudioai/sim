import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListMailboxesParams,
  HelpScoutListMailboxesResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_MAILBOX_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  projectMailbox,
  projectPage,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListMailboxesTool: ToolConfig<
  HelpScoutListMailboxesParams,
  HelpScoutListMailboxesResponse
> = {
  id: 'helpscout_list_mailboxes',
  name: 'Help Scout List Inboxes',
  description: 'List the Help Scout inboxes (mailboxes) the connected user can access.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl('/mailboxes', {
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
        mailboxes: embeddedList(data, 'mailboxes').map(projectMailbox),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    mailboxes: {
      type: 'array',
      description: 'Inboxes on this page',
      items: { type: 'object', properties: HELPSCOUT_MAILBOX_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
