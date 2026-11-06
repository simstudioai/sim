import type {
  GreenhouseRemoveCandidateTagV2Params,
  GreenhouseRemoveCandidateTagV2Response,
} from '@/tools/greenhouse/types'
import { DELETE_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const greenhouseRemoveCandidateTagV2Tool: ToolConfig<
  GreenhouseRemoveCandidateTagV2Params,
  GreenhouseRemoveCandidateTagV2Response
> = {
  id: 'greenhouse_remove_candidate_tag_v2',
  name: 'Greenhouse Remove Candidate Tag',
  description:
    'Removes an applied tag by its applied_candidate_tags row ID, leaving the tag dictionary intact.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Greenhouse resource ID',
    },
  },
  request: {
    url: (params) =>
      `https://harvest.greenhouse.io/v3/applied_candidate_tags/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'DELETE',
    headers: (params) => greenhouseHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response, 'message'), DELETE_V2_OUTPUTS),
  }),
  outputs: { ...DELETE_V2_OUTPUTS },
}
