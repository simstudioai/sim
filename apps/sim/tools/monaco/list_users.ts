import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_USER_OUTPUT_PROPERTIES,
  type MonacoListUsersParams,
  type MonacoListUsersResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoUser, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListUsersTool: ToolConfig<MonacoListUsersParams, MonacoListUsersResponse> = {
  id: 'monaco_list_users',
  name: 'Monaco List Users',
  description:
    "List the users in the Monaco organization, optionally filtered by name or email. Each user's role says whether they are a workspace ADMIN.",
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive substring filter on name or email',
    },
  },

  request: {
    url: (params) => {
      const query = params.query?.trim()
      const url = `${MONACO_API_BASE}/v1/users/`
      return query ? `${url}?query=${encodeURIComponent(query)}` : url
    },
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { users: toArray(data.data).map(mapMonacoUser) } }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Users in the organization',
      items: { type: 'object', properties: MONACO_USER_OUTPUT_PROPERTIES },
    },
  },
}
