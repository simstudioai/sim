import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { WebzSearchParams, WebzSearchResponse } from '@/tools/webz/types'

function stringArray(value: unknown): string[] {
  return toArray(value).filter((item): item is string => typeof item === 'string')
}

export const webzSearchTool: ToolConfig<WebzSearchParams, WebzSearchResponse> = {
  id: 'webz_search',
  name: 'Webz.io News Search',
  description:
    'Search recent news using natural language. Returns relevant articles, matching passages, relevance scores, and source metadata.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Webz.io API key with News API access and available credits',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Natural-language news query, up to 750 characters and 100 words',
    },
    k: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of articles to return, from 1 to 100 (default: 10)',
    },
    publishedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest publication date in YYYY-MM-DD format',
    },
    publishedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest publication date in YYYY-MM-DD format',
    },
    language: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Article languages, for example ["english", "spanish"]',
    },
    country: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Source countries as ISO-2 codes, for example ["US", "GB"]',
    },
    source: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit results to source domains, for example ["reuters.com", "bbc.com"]',
    },
    sentiment: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Article sentiments: positive, negative, or neutral',
    },
    category: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Article categories, for example ["Politics", "Economy, Business and Finance"]',
    },
    scoreGte: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Minimum relevance score from 0 to 10 (default: 4). Set 0 to disable the threshold.',
    },
    scoreLte: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum relevance score from 0 to 10. Omit for no upper bound.',
    },
  },
  request: {
    url: 'https://api.webz.io/api/news/context',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const query = params.query.trim()
      if (!query || Array.from(query).length > 750 || query.split(/\s+/).length > 100) {
        throw new Error('query must contain between 1 and 750 characters and at most 100 words')
      }
      if (
        params.k !== undefined &&
        (!Number.isInteger(params.k) || params.k < 1 || params.k > 100)
      ) {
        throw new Error('k must be an integer between 1 and 100')
      }
      for (const [name, value] of [
        ['scoreGte', params.scoreGte],
        ['scoreLte', params.scoreLte],
      ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 10)) {
          throw new Error(`${name} must be a number between 0 and 10`)
        }
      }
      if (
        params.scoreGte !== undefined &&
        params.scoreLte !== undefined &&
        params.scoreGte > params.scoreLte
      ) {
        throw new Error('scoreGte cannot be greater than scoreLte')
      }

      const filters: Record<string, string | string[]> = {}
      for (const [name, value] of [
        ['published_from', params.publishedAfter],
        ['published_to', params.publishedBefore],
      ] as const) {
        if (value?.trim()) filters[name] = value.trim()
      }
      for (const [name, value] of [
        ['language', params.language],
        ['country', params.country],
        ['domain', params.source],
        ['sentiment', params.sentiment],
        ['category', params.category],
      ] as const) {
        if (value === undefined) continue
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          throw new Error(`${name} must be an array of strings`)
        }
        const items = value.map((item) => item.trim()).filter(Boolean)
        if (items.length > 0) filters[name] = items
      }

      return {
        query,
        ...(params.k !== undefined ? { k: params.k } : {}),
        ...(params.scoreGte !== undefined ? { score_gte: params.scoreGte } : {}),
        ...(params.scoreLte !== undefined ? { score_lte: params.scoreLte } : {}),
        ...(Object.keys(filters).length > 0 ? { filters } : {}),
      }
    },
  },
  transformResponse: async (response) => {
    const data: unknown = await response.json()
    if (
      !isRecordLike(data) ||
      typeof data.query !== 'string' ||
      typeof data.total_results !== 'number' ||
      !Array.isArray(data.results)
    ) {
      throw new Error('Invalid Webz.io News Search response')
    }

    const results = data.results.map((result: unknown) => {
      if (
        !isRecordLike(result) ||
        typeof result.score !== 'number' ||
        !isRecordLike(result.article) ||
        !isRecordLike(result.chunk)
      ) {
        throw new Error('Invalid Webz.io News Search response')
      }
      const article = result.article
      const chunk = result.chunk
      const metadata = toRecord(result.metadata)

      return {
        score: result.score,
        article: {
          article_id: toStringOrNull(article.article_id),
          url: toStringOrNull(article.url),
          title: toStringOrNull(article.title),
          published_at: toStringOrNull(article.published_at),
          summary: toStringOrNull(article.summary),
          main_image: toStringOrNull(article.main_image),
        },
        chunk: {
          chunk_id: toStringOrNull(chunk.chunk_id),
          chunk_index: toNumberOrNull(chunk.chunk_index),
          text: toStringOrNull(chunk.text),
        },
        metadata: {
          language: toStringOrNull(metadata.language),
          country: toStringOrNull(metadata.country),
          category: stringArray(metadata.category),
          sentiment: toStringOrNull(metadata.sentiment),
          domain: toStringOrNull(metadata.domain),
          site_type: toStringOrNull(metadata.site_type),
          topic: stringArray(metadata.topic),
          person: stringArray(metadata.person),
          organization: stringArray(metadata.organization),
          location: stringArray(metadata.location),
          ticker: stringArray(metadata.ticker),
          source_type: toStringOrNull(metadata.source_type),
          political_bias: toStringOrNull(metadata.political_bias),
          trust_category: toStringOrNull(metadata.trust_category),
          domain_rank: toNumberOrNull(metadata.domain_rank),
        },
      }
    })

    return {
      success: true,
      output: {
        query: data.query,
        total_results: data.total_results,
        results,
        requests_left: toNumberOrNull(data.requests_left),
        credits_used: toNumberOrNull(data.credits_used),
      },
    }
  },
  outputs: {
    query: { type: 'string', description: 'The search query' },
    total_results: { type: 'number', description: 'Number of results returned' },
    requests_left: { type: 'number', description: 'Remaining credit balance', nullable: true },
    credits_used: {
      type: 'number',
      description: 'Credits consumed by this request',
      nullable: true,
    },
    results: {
      type: 'array',
      description: 'News articles with matching passages and relevance scores',
      items: {
        type: 'object',
        properties: {
          score: { type: 'number', description: 'Relevance score from 0 to 10' },
          article: {
            type: 'object',
            description: 'Article identity and content summary',
            properties: {
              article_id: { type: 'string', description: 'Unique article ID', nullable: true },
              url: { type: 'string', description: 'Article URL', nullable: true },
              title: { type: 'string', description: 'Article title', nullable: true },
              published_at: {
                type: 'string',
                description: 'Publication timestamp',
                nullable: true,
              },
              summary: { type: 'string', description: 'Article summary', nullable: true },
              main_image: { type: 'string', description: 'Main image URL', nullable: true },
            },
          },
          chunk: {
            type: 'object',
            description: 'The article passage that matches the query',
            properties: {
              chunk_id: { type: 'string', description: 'Unique chunk ID', nullable: true },
              chunk_index: {
                type: 'number',
                description: 'Chunk position in the article',
                nullable: true,
              },
              text: { type: 'string', description: 'Matching passage text', nullable: true },
            },
          },
          metadata: {
            type: 'object',
            description: 'Article enrichment and source information',
            properties: {
              language: { type: 'string', description: 'Article language', nullable: true },
              country: { type: 'string', description: 'Source country code', nullable: true },
              category: {
                type: 'array',
                description: 'Article categories',
                items: { type: 'string' },
              },
              sentiment: { type: 'string', description: 'Article sentiment', nullable: true },
              domain: { type: 'string', description: 'Source domain', nullable: true },
              site_type: { type: 'string', description: 'Source site type', nullable: true },
              topic: { type: 'array', description: 'Topic tags', items: { type: 'string' } },
              person: { type: 'array', description: 'Mentioned people', items: { type: 'string' } },
              organization: {
                type: 'array',
                description: 'Mentioned organizations',
                items: { type: 'string' },
              },
              location: {
                type: 'array',
                description: 'Mentioned locations',
                items: { type: 'string' },
              },
              ticker: {
                type: 'array',
                description: 'Stock ticker symbols',
                items: { type: 'string' },
              },
              source_type: { type: 'string', description: 'Source classification', nullable: true },
              political_bias: {
                type: 'string',
                description: 'Source political bias',
                nullable: true,
              },
              trust_category: {
                type: 'string',
                description: 'Source trust classification',
                nullable: true,
              },
              domain_rank: { type: 'number', description: 'Source domain rank', nullable: true },
            },
          },
        },
      },
    },
  },
}
