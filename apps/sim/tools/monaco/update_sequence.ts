import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_SEQUENCE_DETAIL_OUTPUT_PROPERTIES,
  type MonacoSequenceDetailResponse,
  type MonacoUpdateSequenceParams,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoSequenceDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoUpdateSequenceTool: ToolConfig<
  MonacoUpdateSequenceParams,
  MonacoSequenceDetailResponse
> = {
  id: 'monaco_update_sequence',
  name: 'Monaco Update Sequence',
  description:
    'Apply a state transition (enqueue, pause, resume, stop, or exclude) to a Monaco sequence and return the refreshed sequence with its tasks. Enqueuing or resuming a sequence lets it send real emails and LinkedIn messages to the contact; stopping ends the sequence as failed.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    sequenceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sequence to update',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'State transition to apply: "enqueue" (move a suggested sequence into the queue), "pause" (temporarily halt execution), "resume" (resume a paused sequence), "stop" (end the sequence as failed), or "exclude" (remove a needs_review or staged sequence before it is queued; the sequence moves to excluded)',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/sequences/${safeUrlPathSegment(params.sequenceId, 'sequenceId')}`,
    method: 'PATCH',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => ({ action: params.action.trim() }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { sequence: mapMonacoSequenceDetail(data.data) } }
  },

  outputs: {
    sequence: {
      type: 'object',
      description: 'The refreshed sequence with its ordered tasks',
      properties: MONACO_SEQUENCE_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
