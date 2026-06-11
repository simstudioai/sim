import type { ResembleIntelligenceParams, ResembleResponse } from '@/tools/resemble/types'
import {
  authHeaders,
  baseOf,
  pollResource,
  rItem,
  sanitize,
  TERMINAL,
} from '@/tools/resemble/utils'
import type { ToolConfig } from '@/tools/types'

export const intelligenceTool: ToolConfig<ResembleIntelligenceParams, ResembleResponse> = {
  id: 'resemble_intelligence',
  name: 'Resemble Media Intelligence',
  description:
    'Analyze media for transcription, translation, speaker info, emotion, and misinformation.',
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
    structuredJson: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Return structured JSON fields',
    },
    mediaType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'auto | audio | video | image',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Max seconds to poll',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API base URL override',
    },
  },
  request: {
    url: (p) => `${baseOf(p)}/intelligence`,
    method: 'POST',
    headers: (p) => authHeaders(p),
    body: (p) => {
      const b: Record<string, any> = { url: p.url, json: p.structuredJson !== false }
      if (p.mediaType && p.mediaType !== 'auto') b.media_type = p.mediaType
      return b
    },
  },
  transformResponse: async (response: Response, params?: ResembleIntelligenceParams) => {
    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    if (!response.ok)
      throw new Error((data && data.message) || `Resemble API error: HTTP ${response.status}`)
    const it = rItem(data)
    const status = (it.status || '').toString().toLowerCase()
    if (it.uuid && status && !TERMINAL.has(status) && params) {
      data = await pollResource(
        baseOf(params),
        `/intelligences/${it.uuid}`,
        authHeaders(params),
        params.maxWaitSeconds || 120
      )
    }
    return { success: true, output: { result: sanitize(data) } }
  },
  outputs: { result: { type: 'json', description: 'Structured intelligence analysis.' } },
}
