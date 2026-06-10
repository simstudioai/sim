import type { ToolConfig } from '@/tools/types'
import type { YouResearchParams, YouResearchResponse } from '@/tools/you/types'

export const researchTool: ToolConfig<YouResearchParams, YouResearchResponse> = {
  id: 'you_research',
  name: 'You.com Research',
  description:
    'Run agentic web research with You.com. Takes a complex question, autonomously runs multiple searches, reads sources, and returns a synthesized, well-cited Markdown answer.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'YOU_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'you',
    pricing: {
      type: 'custom',
      getCost: (params) => {
        // You.com Research, per effort tier (CPM / 1000)
        // https://you.com/pricing
        const rates: Record<string, number> = {
          lite: 0.012,
          standard: 0.05,
          deep: 0.1,
          exhaustive: 0.45,
        }
        const effort = (params.research_effort as string) || 'standard'
        const cost = rates[effort] ?? rates.standard
        return { cost, metadata: { effort } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The research question or complex query (up to 40,000 characters)',
    },
    research_effort: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Depth of research: lite (fastest), standard (default), deep, or exhaustive (most thorough)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'You.com API Key',
    },
  },

  request: {
    url: 'https://api.you.com/v1/research',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-API-Key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        input: params.input,
      }
      if (params.research_effort) body.research_effort = params.research_effort
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`You.com research failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const output = data.output ?? {}

    return {
      success: true,
      output: {
        content: (output.content as string | undefined) ?? null,
        content_type: (output.content_type as string | undefined) ?? null,
        sources: ((output.sources ?? []) as Record<string, unknown>[]).map((source) => ({
          url: (source.url as string | undefined) ?? null,
          title: (source.title as string | undefined) ?? null,
          snippets: (source.snippets as string[] | undefined) ?? [],
        })),
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The synthesized research answer (Markdown with inline citations)',
    },
    content_type: {
      type: 'string',
      description: 'Type of the content field: text or object',
      optional: true,
    },
    sources: {
      type: 'array',
      description: 'Web sources used to generate the answer',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The source URL' },
          title: { type: 'string', description: 'The source title' },
          snippets: {
            type: 'array',
            description: 'Relevant snippets extracted from the source',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}
