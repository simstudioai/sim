import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailLookupTechnologiesParams,
  FindymailLookupTechnologiesResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_TECHNOLOGIES_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const lookupTechnologiesTool: ToolConfig<
  FindymailLookupTechnologiesParams,
  FindymailLookupTechnologiesResponse
> = {
  id: 'findymail_lookup_technologies',
  name: 'Findymail Lookup Technologies',
  description:
    'Get the technology stack for a company by domain. Optionally filter by technology names. 1 finder credit if technologies are found, free otherwise.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailLookupTechnologiesParams>((_params, output) => {
    // 1 finder credit when a technology stack is returned, free otherwise.
    return Array.isArray(output.technologies) && output.technologies.length > 0 ? 1 : 0
  }),

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain to look up (e.g., stripe.com)',
    },
    technologies: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by technology names, case-insensitive (e.g., ["React", "TypeScript"])',
      items: { type: 'string' },
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/technologies',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { domain: params.domain }
      if (params.technologies && params.technologies.length > 0) {
        body.technologies = params.technologies
      }
      return body
    },
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
        output: { domain: '', technologies: [] },
      }
    }
    const data = await response.json()
    const raw = data.technologies ?? []
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
    return {
      success: true,
      output: {
        domain: data.domain ?? '',
        technologies,
      },
    }
  },

  outputs: {
    domain: { type: 'string', description: 'The resolved company domain' },
    technologies: FINDYMAIL_TECHNOLOGIES_OUTPUT,
  },
}
