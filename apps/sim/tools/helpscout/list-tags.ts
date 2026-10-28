import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { HelpScoutListTagsParams, HelpScoutListTagsResponse } from '@/tools/helpscout/types'
import { HELPSCOUT_TAG_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  projectPage,
  projectTag,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListTagsTool: ToolConfig<HelpScoutListTagsParams, HelpScoutListTagsResponse> =
  {
    id: 'helpscout_list_tags',
    name: 'Help Scout List Tags',
    description: 'List the tags used across all Help Scout inboxes, in alphabetical order.',
    version: '1.0.0',
    oauth: { required: true, provider: 'helpscout' },
    errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
    params: {
      accessToken: ACCESS_TOKEN_PARAM,
      page: PAGE_PARAM,
    },
    request: {
      url: (params) =>
        buildHelpScoutUrl('/tags', {
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
          tags: embeddedList(data, 'tags').map(projectTag),
          ...projectPage(data),
        },
      }
    },
    outputs: {
      tags: {
        type: 'array',
        description: 'Tags on this page',
        items: { type: 'object', properties: HELPSCOUT_TAG_PROPERTIES },
      },
      ...LIST_PAGE_OUTPUTS,
    },
  }
