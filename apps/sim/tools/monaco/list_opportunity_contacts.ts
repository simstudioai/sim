import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, monacoPageParams } from '@/tools/monaco/params'
import {
  MONACO_OPPORTUNITY_CONTACT_LINK_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListOpportunityContactsParams,
  type MonacoListOpportunityContactsResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoOpportunityContactLink,
  mapMonacoPagination,
  monacoHeaders,
  withMonacoPageQuery,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoListOpportunityContactsTool: ToolConfig<
  MonacoListOpportunityContactsParams,
  MonacoListOpportunityContactsResponse
> = {
  id: 'monaco_list_opportunity_contacts',
  name: 'Monaco List Opportunity Contacts',
  description:
    'List the contacts linked to a Monaco opportunity, with their email, name, title, and how each link was created.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity whose linked contacts to list',
    },
    ...monacoPageParams(50, 100),
  },

  request: {
    url: (params) =>
      withMonacoPageQuery(
        `${MONACO_API_BASE}/v1/opportunities/${safeUrlPathSegment(params.opportunityId, 'opportunityId')}/contacts`,
        params.page,
        params.pageSize
      ),
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        contacts: toArray(data.data).map(mapMonacoOpportunityContactLink),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Contacts linked to the opportunity on this page',
      items: { type: 'object', properties: MONACO_OPPORTUNITY_CONTACT_LINK_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
