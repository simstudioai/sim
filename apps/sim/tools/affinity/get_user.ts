import type { AffinityEntityResponse, AffinityGetUserParams } from '@/tools/affinity/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetUserTool: ToolConfig<
  AffinityGetUserParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_user',
  name: 'Affinity Get User',
  description:
    'Read one internal user. A user and their person record share the same numeric ID, so a person ID works here.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID, which is also their person ID',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/users/${encodeURIComponent(requireId(params.userId, 'userId'))}`),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: USER_OUTPUT_PROPERTIES,
}
