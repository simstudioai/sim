import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_MEETING_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListMeetingsParams,
  type MonacoListMeetingsResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoMeeting,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListMeetingsTool: ToolConfig<
  MonacoListMeetingsParams,
  MonacoListMeetingsResponse
> = {
  id: 'monaco_list_meetings',
  name: 'Monaco List Meetings',
  description:
    'List Monaco meetings with optional filters, sorting, and pagination. Use Get Meeting for the transcript, summary, and recording.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by; prefix with "-" for descending. Defaults to "-start_time". created_at is not a sortable meeting field.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/meetings/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoListBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        meetings: toArray(data.data).map(mapMonacoMeeting),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    meetings: {
      type: 'array',
      description: 'Meetings on this page',
      items: { type: 'object', properties: MONACO_MEETING_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
