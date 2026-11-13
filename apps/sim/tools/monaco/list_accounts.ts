import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_ACCOUNT_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListAccountsParams,
  type MonacoListAccountsResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoAccount,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListAccountsTool: ToolConfig<
  MonacoListAccountsParams,
  MonacoListAccountsResponse
> = {
  id: 'monaco_list_accounts',
  name: 'Monaco List Accounts',
  description: 'List Monaco accounts with optional filters, sorting, and pagination.',
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
        "Include each account's `custom_field_<id>` values. Defaults to false; Get Account always includes them.",
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/accounts/list`,
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
        accounts: toArray(data.data).map(mapMonacoAccount),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Accounts on this page',
      items: { type: 'object', properties: MONACO_ACCOUNT_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
