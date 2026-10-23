import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListCustomFieldsParams,
  HelpScoutListCustomFieldsResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_CUSTOM_FIELD_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  parseHelpScoutId,
  projectCustomField,
  projectPage,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListCustomFieldsTool: ToolConfig<
  HelpScoutListCustomFieldsParams,
  HelpScoutListCustomFieldsResponse
> = {
  id: 'helpscout_list_custom_fields',
  name: 'Help Scout List Custom Fields',
  description:
    'List the custom fields defined for a Help Scout inbox, with their IDs, types, and dropdown options.',
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
      buildHelpScoutUrl(`/mailboxes/${parseHelpScoutId(params.mailboxId, 'mailboxId')}/fields`, {
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
        customFields: embeddedList(data, 'fields').map(projectCustomField),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    customFields: {
      type: 'array',
      description: 'Custom fields on this page',
      items: { type: 'object', properties: HELPSCOUT_CUSTOM_FIELD_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
