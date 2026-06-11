import type {
  PersonaListInquiryTemplatesParams,
  PersonaListInquiryTemplatesResponse,
} from '@/tools/persona/types'
import {
  asResourceList,
  buildPersonaHeaders,
  getNextCursor,
  INQUIRY_TEMPLATE_OUTPUT_PROPERTIES,
  mapInquiryTemplate,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaListInquiryTemplatesTool: ToolConfig<
  PersonaListInquiryTemplatesParams,
  PersonaListInquiryTemplatesResponse
> = {
  id: 'persona_list_inquiry_templates',
  name: 'Persona List Inquiry Templates',
  description:
    'List the inquiry templates in your Persona organization, to discover template IDs for creating inquiries. Results are cursor-paginated.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of templates to return per page (1-100, default 10)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: return templates after this template ID',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.pageSize) searchParams.set('page[size]', String(params.pageSize))
      if (params.pageAfter?.trim()) searchParams.set('page[after]', params.pageAfter.trim())
      const query = searchParams.toString()
      return `${PERSONA_API_BASE}/inquiry-templates${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    const templates = asResourceList(data.data)
    return {
      success: true,
      output: {
        inquiryTemplates: templates.map(mapInquiryTemplate),
        nextCursor: getNextCursor(data.links),
      },
    }
  },

  outputs: {
    inquiryTemplates: {
      type: 'array',
      description: 'Inquiry templates in the organization',
      items: {
        type: 'object',
        properties: INQUIRY_TEMPLATE_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (pass as pageAfter), or null on the last page',
      optional: true,
    },
  },
}
