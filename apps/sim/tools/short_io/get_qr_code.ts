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
      visibility: 'hidden',
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
    url: (params) => `https://api.short.io/links/qr/${params.linkId}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
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
    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText)
      return { success: false, output: { success: false, error: err } }
    }

    const contentType = response.headers.get('Content-Type') ?? ''
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const base64 = typeof btoa !== 'undefined' ? btoa(binary) : ''
    const mediaType = contentType.split(';')[0]?.trim() || 'image/png'
    const dataUrl = base64 ? `data:${mediaType};base64,${base64}` : ''
    return {
      success: true,
      output: { success: true, qrCodeURL: dataUrl },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    qrCodeURL: {
      type: 'string',
      description: 'Base64 data URL of the QR code image (e.g. data:image/png;base64,...)',
    },
    error: { type: 'string', description: 'Error message' },
  },
}
