import { toRecordOrNull } from '@sim/utils/object'
import type { HiggsfieldGenerateParams, HiggsfieldRequestResponse } from '@/tools/higgsfield/types'
import { HIGGSFIELD_REQUEST_OUTPUTS } from '@/tools/higgsfield/types'
import {
  buildGenerationRequest,
  higgsfieldAuthParams,
  higgsfieldGenerationControlParams,
  higgsfieldOAuth,
  mapHiggsfieldRequest,
  normalizeModelEndpoint,
  waitForHiggsfieldRequest,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'

function parseInput(value: HiggsfieldGenerateParams['input']): Record<string, unknown> {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Input must be a valid JSON object')
    }
  }
  const record = toRecordOrNull(parsed)
  if (!record || Array.isArray(parsed)) throw new Error('Input must be a JSON object')
  return record
}

export const higgsfieldGenerateTool: ToolConfig<
  HiggsfieldGenerateParams,
  HiggsfieldRequestResponse
> = {
  id: 'higgsfield_generate',
  name: 'Higgsfield Generate',
  description:
    "Submit a generation request to any Higgsfield image or video model endpoint with that model's documented JSON input, then wait for the output URLs.",
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Model endpoint ID from the Higgsfield model catalog, e.g. kling-video/v2.5-turbo/pro/text-to-video',
    },
    input: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON request body documented for the model endpoint, e.g. {"prompt": "...", "duration": 5}',
    },
    ...higgsfieldGenerationControlParams,
  },
  request: {
    url: (params) => buildGenerationRequest(normalizeModelEndpoint(params.model), params).url,
    method: 'POST',
    headers: (params) =>
      buildGenerationRequest(normalizeModelEndpoint(params.model), params).headers,
    body: (params) => parseInput(params.input),
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapHiggsfieldRequest(await response.json()),
  }),
  postProcess: waitForHiggsfieldRequest,
  outputs: HIGGSFIELD_REQUEST_OUTPUTS,
}
