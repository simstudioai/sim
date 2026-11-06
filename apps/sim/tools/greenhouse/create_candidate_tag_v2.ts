import type {
  GreenhouseCreateCandidateTagV2Params,
  GreenhouseCreateCandidateTagV2Response,
} from '@/tools/greenhouse/types'
import { CANDIDATE_TAGS_V2_OUTPUTS } from '@/tools/greenhouse/v2_outputs'
import {
  greenhouseBody,
  greenhouseHeaders,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'
import type { ToolConfig } from '@/tools/types'

export const greenhouseCreateCandidateTagV2Tool: ToolConfig<
  GreenhouseCreateCandidateTagV2Params,
  GreenhouseCreateCandidateTagV2Response
> = {
  id: 'greenhouse_create_candidate_tag_v2',
  name: 'Greenhouse Create Candidate Tag',
  description: 'Create candidate tag using Greenhouse Harvest v3.',
  version: '2.0.0',
  oauth: { required: true, provider: 'greenhouse' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Greenhouse OAuth access token',
    },
    ...{ name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Name' } },
  },
  request: {
    url: 'https://harvest.greenhouse.io/v3/candidate_tags',
    method: 'POST',
    headers: (params) => greenhouseHeaders(params.accessToken),
    body: (params) =>
      greenhouseBody(
        params,
        { name: { type: 'string', maxLength: 255, required: true } },
        'create_candidate_tag'
      ),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapGreenhouseFields(await readGreenhouseRecord(response), CANDIDATE_TAGS_V2_OUTPUTS),
  }),
  outputs: { ...CANDIDATE_TAGS_V2_OUTPUTS },
}
