import type {
  LoopsListTransactionalEmailsParams,
  LoopsListTransactionalEmailsResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsListTransactionalEmailsTool: ToolConfig<
  LoopsListTransactionalEmailsParams,
  LoopsListTransactionalEmailsResponse
> = {
  id: 'loops_list_transactional_emails',
  name: 'Loops List Transactional Emails',
  description:
    'Retrieve a list of published transactional email templates from your Loops account. Returns each template with its ID, name, last updated timestamp, and data variables.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (10-50, default: 20)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const base = 'https://app.loops.so/api/v1/transactional'
      const queryParams: string[] = []
      if (params.perPage) queryParams.push(`perPage=${encodeURIComponent(params.perPage)}`)
      if (params.cursor) queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      return queryParams.length > 0 ? `${base}?${queryParams.join('&')}` : base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.data && !Array.isArray(data)) {
      return {
        success: false,
        output: {
          transactionalEmails: [],
          pagination: {
            totalResults: 0,
            returnedResults: 0,
            perPage: 0,
            totalPages: 0,
            nextCursor: null,
            nextPage: null,
          },
        },
        error: data.message ?? 'Failed to list transactional emails',
      }
    }

    const emails = data.data ?? data ?? []

    return {
      success: true,
      output: {
        transactionalEmails: emails.map((email: Record<string, unknown>) => ({
          id: (email.id as string) ?? '',
          name: (email.name as string) ?? '',
          lastUpdated: (email.lastUpdated as string) ?? '',
          dataVariables: (email.dataVariables as string[]) ?? [],
        })),
        pagination: {
          totalResults: (data.pagination?.totalResults as number) ?? emails.length,
          returnedResults: (data.pagination?.returnedResults as number) ?? emails.length,
          perPage: (data.pagination?.perPage as number) ?? 20,
          totalPages: (data.pagination?.totalPages as number) ?? 1,
          nextCursor: (data.pagination?.nextCursor as string) ?? null,
          nextPage: (data.pagination?.nextPage as string) ?? null,
        },
      },
    }
  },

  outputs: {
    transactionalEmails: {
      type: 'array',
      description: 'Array of published transactional email templates',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The transactional email template ID' },
          name: { type: 'string', description: 'The template name' },
          lastUpdated: { type: 'string', description: 'Last updated timestamp' },
          dataVariables: {
            type: 'array',
            description: 'Template data variable names',
            items: { type: 'string' },
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        totalResults: { type: 'number', description: 'Total number of results' },
        returnedResults: { type: 'number', description: 'Number of results returned' },
        perPage: { type: 'number', description: 'Results per page' },
        totalPages: { type: 'number', description: 'Total number of pages' },
        nextCursor: {
          type: 'string',
          description: 'Cursor for next page (null if no more pages)',
          optional: true,
        },
        nextPage: {
          type: 'string',
          description: 'URL for next page (null if no more pages)',
          optional: true,
        },
      },
    },
  },
}
