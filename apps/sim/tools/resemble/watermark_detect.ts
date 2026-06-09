import type { ResembleResponse, ResembleWatermarkParams } from '@/tools/resemble/types'
import { authHeaders, baseOf, sanitize } from '@/tools/resemble/utils'
import type { ToolConfig } from '@/tools/types'

export const watermarkDetectTool: ToolConfig<ResembleWatermarkParams, ResembleResponse> = {
  id: 'resemble_watermark_detect',
  name: 'Resemble Detect Watermark',
  description: 'Check whether media contains a Resemble watermark.',
  version: '1.0.0',
  params: {
    apiKey: { type: 'string', required: true, visibility: 'user-only', description: 'Resemble API key' },
    url: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Public HTTPS URL to the media' },
    baseUrl: { type: 'string', required: false, visibility: 'user-only', description: 'API base URL override' },
  },
  request: {
    url: (p) => `${baseOf(p)}/watermark/detect`,
    method: 'POST',
    headers: (p) => authHeaders(p, { Prefer: 'wait' }),
    body: (p) => ({ url: p.url }),
  },
  transformResponse: async (response: Response) => {
    let data: any
    try {
      data = await response.json()
    } catch {
      data = { raw: await response.text() }
    }
    if (!response.ok) throw new Error((data && data.message) || `Resemble API error: HTTP ${response.status}`)
    return { success: true, output: { result: sanitize(data) } }
  },
  outputs: { result: { type: 'json', description: 'Watermark detection result.' } },
}
