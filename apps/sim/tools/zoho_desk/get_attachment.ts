import type { InternalToolConfig } from '@/tools/types'
import type { ZohoDeskGetAttachmentParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'

export const zohoDeskGetAttachmentTool: InternalToolConfig<
  ZohoDeskGetAttachmentParams,
  ZohoDeskResponse
> = {
  id: 'zoho_desk_get_attachment',
  name: 'Zoho Desk Get Attachment',
  description: 'Download a Zoho Desk ticket attachment (from its href) as a file.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zoho Desk organization ID',
    },
    href: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Attachment download href (from a thread or comment attachment)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional file name for the downloaded file',
    },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      orgId: params.orgId,
      href: params.href,
      fileName: params.fileName,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || `Failed to download attachment (HTTP ${response.status})`)
    }
    return {
      success: true,
      output: { file: data.output?.file },
    }
  },

  outputs: {
    file: { type: 'file', description: 'The downloaded attachment file' },
  },
}
