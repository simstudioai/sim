import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { YouComAnswerParams, YouComAnswerResponse } from '@/tools/youcom/types'
import {
  ANSWER_LANGUAGES,
  buildDomainFilters,
  toCode,
  YOUCOM_API_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComAnswerTool: ToolConfig<YouComAnswerParams, YouComAnswerResponse> = {
  id: 'youcom_answer',
  name: 'You.com Answer',
  description:
    'Get a synthesized answer to a question with numbered citations and the web results used to write it.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to answer',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Result recency: day, week, month, year, or a range like 2025-01-01to2025-12-31',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code that sets the geographic focus (e.g., US, GB, DE)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCP 47 language code for results (e.g., EN, FR, DE)',
    },
    safesearch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content moderation filter: off, moderate, or strict. Defaults to moderate',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated domains to restrict results to (up to 500). Cannot be combined with exclude or boost domains',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains to remove from results (up to 500)',
    },
    boostDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains to rank higher without filtering others (up to 500)',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ query: params.query }),
    },
    url: `${YOUCOM_API_BASE_URL}/answer`,
    method: 'POST',
    headers: youComHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
        ...buildDomainFilters(params),
      }
      if (params.freshness) body.freshness = params.freshness.trim()
      const country = toCode(params.country)
      if (country) body.country = country
      const language = toCode(params.language)
      if (language && ANSWER_LANGUAGES.has(language)) body.language = language
      if (params.safesearch) body.safesearch = params.safesearch
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const results = toRecordOrNull(data.results) ?? {}

    return {
      success: true,
      output: {
        answer: String(data.answer ?? ''),
        citations: toArray(data.citations).map((item) => {
          const citation = toRecordOrNull(item) ?? {}
          return {
            source: String(citation.source ?? ''),
            excerpts: toArray(citation.excerpts).map(String),
          }
        }),
        results: toArray(results.web).map((item) => {
          const result = toRecordOrNull(item) ?? {}
          return {
            url: String(result.url ?? ''),
            title: String(result.title ?? ''),
            snippets: toArray(result.snippets).map(String),
            description: toStringOrNull(result.description),
            thumbnailUrl: toStringOrNull(result.thumbnail_url),
            pageAge: toStringOrNull(result.page_age),
          }
        }),
      },
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'Synthesized answer with numbered inline citations referencing citations',
    },
    citations: {
      type: 'array',
      description: 'Sources cited in the answer, in citation order',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'URL of the cited source' },
          excerpts: {
            type: 'array',
            description: 'Verbatim excerpts from the source that support the answer',
            items: { type: 'string' },
          },
        },
      },
    },
    results: {
      type: 'array',
      description: 'All web results considered while writing the answer, cited or not',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the source webpage' },
          title: { type: 'string', description: 'Title of the source webpage' },
          snippets: {
            type: 'array',
            description: 'Text snippets previewing the content',
            items: { type: 'string' },
          },
          description: { type: 'string', description: 'Brief description', nullable: true },
          thumbnailUrl: { type: 'string', description: 'Thumbnail URL', nullable: true },
          pageAge: { type: 'string', description: 'Age of the result', nullable: true },
        },
      },
    },
  },
}
