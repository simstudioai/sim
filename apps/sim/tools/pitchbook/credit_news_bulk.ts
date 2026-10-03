import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookCreditNewsBulkParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Normalize the caller's article ids into the numeric list PitchBook expects.
 *
 * The block runs the code subblock through `JSON.parse`, which happily yields a
 * non-array for input like `{}` or `5`, and a direct tool call can hand the raw
 * text over untouched. Both reach here, so parse a string, reject anything that
 * is not a list of numbers, and fail with a message that names the problem
 * instead of a bare `.map is not a function`.
 */
function toArticleIds(value: unknown): number[] {
  let raw = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') raw = []
    else {
      try {
        raw = JSON.parse(trimmed)
      } catch {
        throw new Error('Article IDs must be a JSON array of numbers, e.g. [11041384, 2142401]')
      }
    }
  }
  if (!Array.isArray(raw)) {
    throw new Error('Article IDs must be a JSON array of numbers, e.g. [11041384, 2142401]')
  }
  return raw.map((articleId) => {
    const parsed = Number(articleId)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Article ID "${String(articleId)}" is not a number`)
    }
    return parsed
  })
}

export const pitchbookCreditNewsBulkTool: ToolConfig<
  PitchbookCreditNewsBulkParams,
  PitchbookResponse
> = {
  id: 'pitchbook_credit_news_bulk',
  name: 'PitchBook Credit News Bulk',
  description:
    'Retrieve many credit analysis articles in full in a single call, reporting which IDs were found, missing, or duplicated',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    articleIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Credit news article IDs to fetch, e.g. [11041384, 2142401]',
      items: { type: 'number', description: 'Credit news article ID' },
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: () => `${PITCHBOOK_API_BASE}/credit-analysis/credit-news`,
    method: 'POST',
    headers: (params) => ({
      ...pitchbookAuthHeaders(params.apiKey, params.currency),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      items: toArticleIds(params.articleIds).map((articleId) => ({ articleId })),
    }),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch credit news articles')
    const data = await response.json()

    return {
      success: true,
      output: {
        stats: data.stats ?? null,
        found: data.found ?? [],
        notFound: data.notFound ?? [],
        duplicates: data.duplicates ?? [],
      },
    }
  },

  outputs: {
    stats: {
      type: 'object',
      description: 'Summary statistics for the response',
      properties: {
        total: { type: 'number', description: 'Total number of matching results' },
        found: { type: 'number', description: 'Articles that were found' },
        notFound: { type: 'number', description: 'Article IDs that were not found' },
        duplicates: {
          type: 'number',
          description: 'Article IDs that were requested more than once',
        },
      },
    },
    found: {
      type: 'array',
      description: 'Articles that were found',
      items: {
        type: 'object',
        properties: {
          articleId: { type: 'number', description: 'Credit news article ID' },
          title: { type: 'string', description: 'Title' },
          authors: {
            type: 'array',
            description: 'Authors of the article',
            items: {
              type: 'object',
              properties: {
                authorName: { type: 'string', description: 'Author name' },
              },
            },
          },
          regions: {
            type: 'array',
            description: 'Geographic regions the article covers',
            items: { type: 'string' },
          },
          publishDate: { type: 'string', description: 'Publication timestamp (ISO 8601)' },
          assetClasses: {
            type: 'array',
            description: 'Asset classes the article covers',
            items: { type: 'string' },
          },
          topics: {
            type: 'array',
            description: 'Topics the article covers',
            items: { type: 'string' },
          },
          issuer: {
            type: 'object',
            description: 'Issuer the article is about',
            nullable: true,
            properties: {
              pbId: { type: 'string', description: 'PitchBook entity ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
          lender: { type: 'json', description: 'Lender the article is about', nullable: true },
          sponsor: { type: 'json', description: 'Sponsor the article is about', nullable: true },
          articleBody: { type: 'string', description: 'Full text of the article' },
          attachments: {
            type: 'array',
            description: 'Attachments on the article',
            items: { type: 'json' },
          },
          deal: {
            type: 'object',
            description: 'Deal the record belongs to',
            nullable: true,
            properties: {
              dealId: { type: 'string', description: 'PitchBook deal ID' },
            },
          },
        },
      },
    },
    notFound: {
      type: 'array',
      description: 'Article IDs that were not found',
      items: { type: 'json' },
    },
    duplicates: {
      type: 'array',
      description: 'Article IDs that were requested more than once',
      items: { type: 'json' },
    },
  },
}
