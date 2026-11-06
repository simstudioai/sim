import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListFoldersParams,
  HelpScoutListFoldersResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_FOLDER_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseHelpScoutId,
  projectFolder,
  projectPage,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListFoldersTool: ToolConfig<
  HelpScoutListFoldersParams,
  HelpScoutListFoldersResponse
> = {
  id: 'helpscout_list_folders',
  name: 'Help Scout List Folders',
  description: 'List the folders in a Help Scout inbox with their conversation counts.',
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
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl(`/mailboxes/${parseHelpScoutId(params.mailboxId, 'mailboxId')}/folders`, {
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
        folders: embeddedList(data, 'folders').map(projectFolder),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    folders: {
      type: 'array',
      description: 'Folders on this page',
      items: { type: 'object', properties: HELPSCOUT_FOLDER_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
