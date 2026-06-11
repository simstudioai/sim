import type {
  PersonaPrintInquiryPdfParams,
  PersonaPrintInquiryPdfResponse,
} from '@/tools/persona/types'
import {
  extractPersonaErrorMessage,
  PERSONA_API_BASE,
  PERSONA_API_VERSION,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaPrintInquiryPdfTool: ToolConfig<
  PersonaPrintInquiryPdfParams,
  PersonaPrintInquiryPdfResponse
> = {
  id: 'persona_print_inquiry_pdf',
  name: 'Persona Print Inquiry PDF',
  description:
    'Download a PDF summary of an inquiry, including its collected information and verification results.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    inquiryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inquiry ID to print (starts with inq_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/print`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Persona-Version': PERSONA_API_VERSION,
      Accept: 'application/pdf',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const fallback = `Persona API error: ${response.status} ${response.statusText}`
      const errorBody: unknown = await response
        .text()
        .then((text) => JSON.parse(text))
        .catch(() => null)
      throw new Error(extractPersonaErrorMessage(errorBody, fallback))
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const inquiryId = params?.inquiryId?.trim() ?? 'inquiry'
    return {
      success: true,
      output: {
        file: {
          name: `${inquiryId}.pdf`,
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
          size: buffer.length,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'PDF summary of the inquiry, stored in execution files',
      fileConfig: {
        mimeType: 'application/pdf',
        extension: 'pdf',
      },
    },
  },
}
