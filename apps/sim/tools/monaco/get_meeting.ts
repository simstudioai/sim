import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_MEETING_DETAIL_OUTPUT_PROPERTIES,
  type MonacoGetMeetingParams,
  type MonacoGetMeetingResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoMeetingDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetMeetingTool: ToolConfig<MonacoGetMeetingParams, MonacoGetMeetingResponse> = {
  id: 'monaco_get_meeting',
  name: 'Monaco Get Meeting',
  description:
    'Get one Monaco meeting by ID, including AI pre-meeting notes, the AI summary, a presigned recording URL, and the full speaker-attributed transcript with word-level timestamps. The transcript is returned untruncated and can be very large for long meetings.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (UUID) of the meeting to fetch',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/meetings/${safeUrlPathSegment(params.meetingId, 'meetingId')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { meeting: mapMonacoMeetingDetail(data.data) } }
  },

  outputs: {
    meeting: {
      type: 'object',
      description: 'The meeting with notes, summary, recording URL, and transcript',
      properties: MONACO_MEETING_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
