import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, monacoPageParams } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListAudienceContactsParams,
  type MonacoListAudienceContactsResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoContact,
  mapMonacoPagination,
  monacoHeaders,
  withMonacoPageQuery,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoListAudienceContactsTool: ToolConfig<
  MonacoListAudienceContactsParams,
  MonacoListAudienceContactsResponse
> = {
  id: 'monaco_list_audience_contacts',
  name: 'Monaco List Audience Contacts',
  description: 'List the contacts in a Monaco audience, one page at a time.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the audience whose contacts to list',
    },
    ...monacoPageParams(15, 500),
  },

  request: {
    url: (params) =>
      withMonacoPageQuery(
        `${MONACO_API_BASE}/v1/audiences/${safeUrlPathSegment(params.audienceId, 'audienceId')}/contacts`,
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
        contacts: toArray(data.data).map(mapMonacoContact),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Contacts in the audience on this page',
      items: { type: 'object', properties: MONACO_CONTACT_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
