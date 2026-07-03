import type {
  LoopsGetTransactionalEmailParams,
  LoopsGetTransactionalEmailResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsGetTransactionalEmailTool: ToolConfig<
  LoopsGetTransactionalEmailParams,
  LoopsGetTransactionalEmailResponse
> = {
  id: 'loops_get_transactional_email',
  name: 'Loops Get Transactional Email',
  description:
    'Retrieve a single transactional email template from your Loops account by its ID, including its data variables and draft/published message IDs.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    transactionalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the transactional email template to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://app.loops.so/api/v1/transactional-emails/${encodeURIComponent(params.transactionalId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.id) {
      return {
        success: false,
        output: {
          id: null,
          name: null,
          draftEmailMessageId: null,
          publishedEmailMessageId: null,
          transactionalGroupId: null,
          createdAt: null,
          updatedAt: null,
          dataVariables: [],
        },
        error: data.message ?? 'Failed to get transactional email',
      }
    }

    return {
      success: true,
      output: {
        id: (data.id as string) ?? null,
        name: (data.name as string) ?? null,
        draftEmailMessageId: (data.draftEmailMessageId as string) ?? null,
        publishedEmailMessageId: (data.publishedEmailMessageId as string) ?? null,
        transactionalGroupId: (data.transactionalGroupId as string) ?? null,
        createdAt: (data.createdAt as string) ?? null,
        updatedAt: (data.updatedAt as string) ?? null,
        dataVariables: (data.dataVariables as string[]) ?? [],
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The transactional email template ID', optional: true },
    name: { type: 'string', description: 'The template name', optional: true },
    draftEmailMessageId: {
      type: 'string',
      description: 'ID of the draft email message, if any',
      optional: true,
    },
    publishedEmailMessageId: {
      type: 'string',
      description: 'ID of the published email message, if any',
      optional: true,
    },
    transactionalGroupId: {
      type: 'string',
      description: 'ID of the transactional group this template belongs to, if any',
      optional: true,
    },
    createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)', optional: true },
    updatedAt: {
      type: 'string',
      description: 'Last updated timestamp (ISO 8601)',
      optional: true,
    },
    dataVariables: {
      type: 'array',
      description: 'Template data variable names',
      items: { type: 'string' },
    },
  },
}
