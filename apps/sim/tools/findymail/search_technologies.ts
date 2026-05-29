import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailSearchTechnologiesParams,
  FindymailSearchTechnologiesResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_TECHNOLOGIES_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const searchTechnologiesTool: ToolConfig<
  FindymailSearchTechnologiesParams,
  FindymailSearchTechnologiesResponse
> = {
  id: 'findymail_search_technologies',
  name: 'Findymail Search Technologies',
  description:
    'Search the technology catalog by name. Returns up to 25 technologies. Free endpoint, rate limited to 10 requests per minute.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailSearchTechnologiesParams>(() => {
    // Free catalog search — consumes no Findymail credits.
    return 0
  }),

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search term (min 2 characters, e.g., "React")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://app.findymail.com/api/technologies/search')
      url.searchParams.append('q', params.q)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: { technologies: [] },
      }
    }
    const data = await response.json()
    const raw = data.data ?? []
    const technologies = Array.isArray(raw)
      ? raw.map(
          (t: {
            name?: string
            category?: string
            subcategory?: string
            last_detected_at?: string
          }) => ({
            name: t.name ?? '',
            category: t.category ?? null,
            subcategory: t.subcategory ?? null,
            last_detected_at: t.last_detected_at ?? null,
          })
        )
      : []
    return { success: true, output: { technologies } }
  },

  outputs: {
    technologies: FINDYMAIL_TECHNOLOGIES_OUTPUT,
  },
}
