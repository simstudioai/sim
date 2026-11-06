import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListOrganizationsParams,
  HelpScoutListOrganizationsResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_ORGANIZATION_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  projectOrganization,
  projectPage,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

const SORT_PATTERN = /^(name|customerCount|conversationCount|lastInteractionAt)(,(asc|desc))?$/

export const helpScoutListOrganizationsTool: ToolConfig<
  HelpScoutListOrganizationsParams,
  HelpScoutListOrganizationsResponse
> = {
  id: 'helpscout_list_organizations',
  name: 'Help Scout List Organizations',
  description:
    'List Help Scout organizations (companies), 50 per page, most recently active first by default.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    organizationSort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'name, customerCount, conversationCount, or lastInteractionAt, optionally with ,asc or ,desc (defaults to lastInteractionAt,desc)',
    },
    page: PAGE_PARAM,
  },
  request: {
    url: (params) => {
      const sort = params.organizationSort?.trim()
      if (sort && !SORT_PATTERN.test(sort)) {
        throw new Error(
          'organizationSort must be name, customerCount, conversationCount, or lastInteractionAt, optionally followed by ,asc or ,desc'
        )
      }
      return buildHelpScoutUrl('/organizations', {
        sort: sort || undefined,
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
        organizations: embeddedList(data, 'organizations').map(projectOrganization),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    organizations: {
      type: 'array',
      description: 'Organizations on this page',
      items: { type: 'object', properties: HELPSCOUT_ORGANIZATION_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
