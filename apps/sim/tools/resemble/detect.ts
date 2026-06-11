import type { ResembleDetectParams, ResembleResponse } from '@/tools/resemble/types'
import { authHeaders, baseOf, pollResource, rItem, sanitize } from '@/tools/resemble/utils'
import type { ToolConfig } from '@/tools/types'

export const detectTool: ToolConfig<ResembleDetectParams, ResembleResponse> = {
  id: 'resemble_detect',
  name: 'Resemble Deepfake Detection',
  description: 'Detect whether media (audio, image, or video) is a deepfake / AI-generated.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resemble API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL to the media',
    },
    runIntelligence: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Also run media intelligence',
    },
    audioSourceTracing: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Trace the source platform of fake audio',
    },
    visualize: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Generate heatmap artifacts',
    },
    useReverseSearch: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Image-only reverse image search',
    },
    useOodDetector: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Out-of-distribution detection',
    },
    zeroRetentionMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Auto-delete media after analysis',
    },
    modelTypes: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'auto | image | talking_head',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Max seconds to poll for the result',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API base URL override',
    },
  },
  request: {
    url: (p) => `${baseOf(p)}/detect`,
    method: 'POST',
    headers: (p) => authHeaders(p),
    body: (p) => {
      const b: Record<string, any> = { url: p.url }
      if (p.runIntelligence) b.intelligence = true
      if (p.audioSourceTracing) b.audio_source_tracing = true
      if (p.visualize) b.visualize = true
      if (p.useReverseSearch) b.use_reverse_search = true
      if (p.useOodDetector) b.use_ood_detector = true
      if (p.zeroRetentionMode) b.zero_retention_mode = true
      if (p.modelTypes && p.modelTypes !== 'auto') b.model_types = p.modelTypes
      return b
    },
  },
  transformResponse: async (response: Response, params?: ResembleDetectParams) => {
    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    if (!response.ok)
      throw new Error((data && data.message) || `Resemble API error: HTTP ${response.status}`)
    const uuid = rItem(data).uuid
    if (uuid && params) {
      data = await pollResource(
        baseOf(params),
        `/detect/${uuid}`,
        authHeaders(params),
        params.maxWaitSeconds || 120
      )
    }
    return { success: true, output: { result: sanitize(data) } }
  },
  outputs: {
    result: {
      type: 'json',
      description: 'Detection result (label, score, metrics, optional intelligence).',
    },
  },
}
