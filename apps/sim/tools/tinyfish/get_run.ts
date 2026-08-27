import {
  RUN_SUMMARY_OUTPUT_PROPERTIES,
  type TinyFishGetRunParams,
  type TinyFishGetRunResponse,
  type TinyFishRawRunDetail,
} from '@/tools/tinyfish/types'
import {
  mapRunSummary,
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

export const getRunTool: ToolConfig<TinyFishGetRunParams, TinyFishGetRunResponse> = {
  id: 'tinyfish_get_run',
  name: 'TinyFish Get Run',
  description:
    'Get the status, extracted result, and step history of a TinyFish automation run by its ID',
  version: '1.0.0',

  params: {
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the run to look up',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  request: {
    url: (params) =>
      `${TINYFISH_AGENT_API_BASE}/v1/runs/${encodeURIComponent(params.runId.trim())}`,
    method: 'GET',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = (await response.json()) as TinyFishRawRunDetail

    return {
      success: true,
      output: {
        ...mapRunSummary(data),
        videoUrl: data.video_url ?? null,
        steps: (data.steps ?? []).map((step) => ({
          id: step?.id ?? '',
          timestamp: step?.timestamp ?? '',
          status: step?.status ?? 'PENDING',
          action: step?.action ?? null,
          duration: step?.duration ?? null,
        })),
      },
    }
  },

  outputs: {
    ...RUN_SUMMARY_OUTPUT_PROPERTIES,
    videoUrl: {
      type: 'string',
      description: 'Presigned recording URL, expires 15 minutes after it is issued',
      optional: true,
    },
    steps: {
      type: 'array',
      description: 'Steps the agent took during the run',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Step identifier' },
          timestamp: { type: 'string', description: 'ISO 8601 timestamp of the step' },
          status: { type: 'string', description: 'Status of the run at this step' },
          action: { type: 'string', description: 'Action the agent took', optional: true },
          duration: { type: 'string', description: 'Time the step took', optional: true },
        },
      },
    },
  },
}
