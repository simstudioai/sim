import type { SESListTemplatesParams, SESListTemplatesResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const listTemplatesTool: ToolConfig<SESListTemplatesParams, SESListTemplatesResponse> = {
  id: 'ses_list_templates',
  name: 'SES List Templates',
  description: 'List all SES email templates in your account',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of templates to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous list response',
    },
  },

  request: {
    url: '/api/tools/ses/list-templates',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      pageSize: params.pageSize,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list templates')
    }

    return {
      success: true,
      output: {
        templates: data.templates ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    templates: {
      type: 'array',
      description: 'List of email templates with name and creation timestamp',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of templates returned' },
  },
}
