import type {
  LoopsListMailingListsParams,
  LoopsListMailingListsResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsListMailingListsTool: ToolConfig<
  LoopsListMailingListsParams,
  LoopsListMailingListsResponse
> = {
  id: 'loops_list_mailing_lists',
  name: 'Loops List Mailing Lists',
  description:
    'Retrieve all mailing lists from your Loops account. Returns each list with its ID, name, description, and public/private status.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/lists',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!Array.isArray(data)) {
      return {
        success: false,
        output: {
          mailingLists: [],
        },
        error: data.message ?? 'Failed to list mailing lists',
      }
    }

    return {
      success: true,
      output: {
        mailingLists: data.map((list: Record<string, unknown>) => ({
          id: (list.id as string) ?? '',
          name: (list.name as string) ?? '',
          description: (list.description as string) ?? null,
          isPublic: (list.isPublic as boolean) ?? false,
        })),
      },
    }
  },

  outputs: {
    mailingLists: {
      type: 'array',
      description: 'Array of mailing list objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The mailing list ID' },
          name: { type: 'string', description: 'The mailing list name' },
          description: {
            type: 'string',
            description: 'The mailing list description (null if not set)',
            optional: true,
          },
          isPublic: {
            type: 'boolean',
            description: 'Whether the list is public or private',
          },
        },
      },
    },
  },
}
