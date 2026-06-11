import type { ResembleResponse, ResembleWatermarkParams } from '@/tools/resemble/types'
import { authHeaders, baseOf, pollResource, rItem, sanitize } from '@/tools/resemble/utils'
import type { ToolConfig } from '@/tools/types'

export const watermarkApplyTool: ToolConfig<ResembleWatermarkParams, ResembleResponse> = {
  id: 'resemble_watermark_apply',
  name: 'Resemble Apply Watermark',
  description:
    'Apply an invisible Resemble provenance watermark and return the watermarked media (audio-first).',
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
    strength: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Watermark strength 0.0–1.0 (image/video only)',
    },
    customMessage: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Message to embed (image/video only)',
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
    url: (p) => `${baseOf(p)}/watermark/apply`,
    method: 'POST',
    headers: (p) => authHeaders(p, { Prefer: 'wait' }),
    body: (p) => {
      const b: Record<string, any> = { url: p.url }
      if (p.strength != null) b.strength = Number(p.strength)
      if (p.customMessage) b.custom_message = p.customMessage
      return b
    },
  },
  transformResponse: async (response: Response, params?: ResembleWatermarkParams) => {
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
    if (!(it.watermarked_media || it.url) && it.uuid && params) {
      // The apply result has no `status` field — done means the media URL is present.
      data = await pollResource(
        baseOf(params),
        `/watermark/apply/${it.uuid}/result`,
        authHeaders(params),
        params.maxWaitSeconds || 120,
        (d) => {
          const r = rItem(d)
          return !!(r.watermarked_media || r.url)
        }
      )
    }
    return { success: true, output: { result: sanitize(data) } }
  },
  outputs: { result: { type: 'json', description: 'Watermarked media result.' } },
}
