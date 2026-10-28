import type {
  GreenhouseApplyCandidateTagV2Params,
  GreenhouseApplyCandidateTagV2Response,
} from '@/tools/greenhouse/types'
import { APPLIED_CANDIDATE_TAGS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseApplyCandidateTagV2Tool: ToolConfig<
  GreenhouseApplyCandidateTagV2Params,
  GreenhouseApplyCandidateTagV2Response
> = {
  id: 'greenhouse_apply_candidate_tag_v2',
  name: 'Greenhouse Apply Candidate Tag',
  description: 'Apply candidate tag using Greenhouse Harvest v3.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    candidate_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate ID to tag.',
    },
    candidate_tag_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate tag ID',
    },
  },
  request: {
    url: 'https://harvest.greenhouse.io/v3/applied_candidate_tags',
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        {
          candidate_id: { type: 'integer', required: true },
          candidate_tag_id: { type: 'integer', required: true },
        },
        'apply_candidate_tag'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(
      await readGreenhouseRecord(response),
      APPLIED_CANDIDATE_TAGS_V2_OUTPUTS
    ),
  }),
  outputs: { ...APPLIED_CANDIDATE_TAGS_V2_OUTPUTS },
}
