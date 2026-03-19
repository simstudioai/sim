import type {
  DocuSignListTemplatesParams,
  DocuSignListTemplatesResponse,
} from '@/tools/docusign/types'
import { TEMPLATES_ARRAY_OUTPUT } from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignListTemplatesTool: ToolConfig<
  DocuSignListTemplatesParams,
  DocuSignListTemplatesResponse
> = {
  id: 'docusign_list_templates',
  name: 'List DocuSign Templates',
  description: 'List available templates in your DocuSign account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'docusign',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'DocuSign OAuth access token',
    },
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text to filter templates by name',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of templates to return',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'list_templates',
      searchText: params.searchText,
      count: params.count,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to list templates')
    }
    const templates = (data.envelopeTemplates ?? []).map((t: Record<string, unknown>) => ({
      templateId: t.templateId ?? null,
      name: t.name ?? null,
      description: t.description ?? null,
      shared: t.shared === 'true' || t.shared === true,
      created: t.created ?? null,
      lastModified: t.lastModified ?? null,
    }))
    return {
      success: true,
      output: {
        templates,
        totalSetSize: Number(data.totalSetSize) || 0,
        resultSetSize: Number(data.resultSetSize) || templates.length,
      },
    }
  },

  outputs: {
    templates: TEMPLATES_ARRAY_OUTPUT,
    totalSetSize: { type: 'number', description: 'Total number of matching templates' },
    resultSetSize: { type: 'number', description: 'Number of templates returned in this response' },
  },
}
