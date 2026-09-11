import { omit } from '@sim/utils/object'
import type {
  DubGetQrCodeParams,
  DubGetQrCodeResponse,
  DubGetQrCodeV2Response,
} from '@/tools/dub/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

async function transformDownloadResponse(response: Response) {
  if (!response.ok) {
    const errorText = await response.text()
    let message = errorText || `Failed to generate QR code: ${response.status}`
    try {
      const parsed = JSON.parse(errorText)
      message = parsed.error?.message || parsed.error || message
    } catch {
      /** Non-JSON error body; use the raw text. */
    }
    throw new Error(message)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = response.headers.get('content-type') || 'image/png'

  return {
    success: true,
    output: {
      file: {
        name: 'qrcode.png',
        mimeType,
        data: buffer,
        size: buffer.length,
      },
    },
  }
}

export const getQrCodeTool = {
  id: 'dub_get_qr_code',
  name: 'Dub Get QR Code',
  description:
    'Generate a customizable QR code (PNG) for a short link, with control over size, error correction, colors, and margin.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The short link URL to encode in the QR code',
    },
    logo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL of a custom logo to embed in the QR code (requires a paid Dub plan)',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'QR code size in pixels (default: 600)',
    },
    level: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Error correction level: L (default), M, Q, or H',
    },
    fgColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Foreground color in hex (default: #000000)',
    },
    bgColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background color in hex (default: #FFFFFF)',
    },
    hideLogo: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to hide the logo in the center of the QR code (default: false)',
    },
    margin: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Margin (quiet zone) around the QR code (default: 2)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/qr')
      url.searchParams.set('url', params.url.trim())
      if (params.logo) url.searchParams.set('logo', params.logo)
      if (params.size !== undefined) url.searchParams.set('size', String(params.size))
      if (params.level) url.searchParams.set('level', params.level)
      if (params.fgColor) url.searchParams.set('fgColor', params.fgColor)
      if (params.bgColor) url.searchParams.set('bgColor', params.bgColor)
      if (params.hideLogo !== undefined) url.searchParams.set('hideLogo', String(params.hideLogo))
      if (params.margin !== undefined) url.searchParams.set('margin', String(params.margin))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'image/png',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const result = await transformDownloadResponse(response)
    const file = result.output.file
    const content = file.data.toString('base64')
    return {
      ...result,
      output: {
        ...result.output,
        file: { ...file, data: content },
        content,
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Generated QR code image stored in execution files',
    },
    content: {
      type: 'string',
      description: 'Base64-encoded PNG image data',
    },
  },
} satisfies ToolConfig<DubGetQrCodeParams, DubGetQrCodeResponse>

export const getQrCodeV2Tool: ToolConfig<
  DubGetQrCodeParams,
  DubGetQrCodeV2Response<ToolFileData>
> = {
  ...getQrCodeTool,
  id: 'dub_get_qr_code_v2',
  version: '2.0.0',
  request: { ...getQrCodeTool.request, responseType: 'binary' },
  transformResponse: transformDownloadResponse,
  outputs: omit(getQrCodeTool.outputs, ['content']),
}
