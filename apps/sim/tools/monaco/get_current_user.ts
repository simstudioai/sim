import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_CURRENT_USER_OUTPUT_PROPERTIES,
  type MonacoGetCurrentUserParams,
  type MonacoGetCurrentUserResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoCurrentUser, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoGetCurrentUserTool: ToolConfig<
  MonacoGetCurrentUserParams,
  MonacoGetCurrentUserResponse
> = {
  id: 'monaco_get_current_user',
  name: 'Monaco Get Current User',
  description: 'Get the Monaco user and organization the API key belongs to.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/me`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { currentUser: mapMonacoCurrentUser(data.data) } }
  },

  outputs: {
    currentUser: {
      type: 'object',
      description: 'The authenticated user and organization',
      properties: MONACO_CURRENT_USER_OUTPUT_PROPERTIES,
    },
  },
}
