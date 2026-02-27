import type { ShortIoGetQrParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const shortIoGetQrCodeTool: ToolConfig<ShortIoGetQrParams, ToolResponse> = {
  id: 'short_io_get_qr_code',
  name: 'Short.io Generate QR Code',
  description: 'Generate a QR code for a Short.io link (POST /links/qr/{linkIdString}).',
  version: '1.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Short.io Secret API Key',
    },
    linkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Link ID (e.g. lnk_abc123_abcdef)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QR color hex (e.g. 000000)',
    },
    backgroundColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background color hex (e.g. FFFFFF)',
    },
    size: { type: 'number', required: false, visibility: 'user-or-llm', description: 'QR size 1–99' },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: png or svg',
    },
    useDomainSettings: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Use domain settings (default true)',
    },
  },
  request: {
    url: '/api/tools/short_io/qr',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        apiKey: params.apiKey,
        linkId: params.linkId,
        useDomainSettings: params.useDomainSettings ?? true,
      }
      if (params.color != null && params.color !== '') body.color = params.color
      if (params.backgroundColor != null && params.backgroundColor !== '') body.backgroundColor = params.backgroundColor
      if (params.size != null && params.size >= 1 && params.size <= 99) body.size = params.size
      if (params.type === 'svg' || params.type === 'png') body.type = params.type
      return body
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.success) {
      return {
        success: false,
        output: { success: false, error: data.error || response.statusText },
      }
    }
    return {
      success: true,
      output: data.output,
    }
  },
  outputs: {
    file: {
      type: 'file',
      description: 'Generated QR code image file',
    },
  },
}
