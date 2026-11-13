import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListContactsParams,
  type MonacoListContactsResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoContact,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListContactsTool: ToolConfig<
  MonacoListContactsParams,
  MonacoListContactsResponse
> = {
  id: 'monaco_list_contacts',
  name: 'Monaco List Contacts',
  description: 'List Monaco contacts with optional filters, sorting, and pagination.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
    includeCustomFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Include each contact's `custom_field_<id>` values. Defaults to false; Get Contact always includes them.",
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/contacts/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => ({
      ...buildMonacoListBody(params),
      ...(params.includeCustomFields === undefined
        ? {}
        : { include_custom_fields: params.includeCustomFields }),
    }),
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
      description: 'Contacts on this page',
      items: { type: 'object', properties: MONACO_CONTACT_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
