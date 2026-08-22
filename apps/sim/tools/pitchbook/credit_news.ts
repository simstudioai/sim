import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCreditNewsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_credit_news',
  name: 'PitchBook Credit News Article',
  description:
    'Retrieve one credit analysis article in full, including its body text, authors, topics, and the issuer, lender, and sponsor it covers',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Credit news article ID, e.g. 1312103. Article IDs come from a credit news search.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/credit-analysis/credit-news/${params.pbId.trim()}`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch credit news article')
    const data = await response.json()

    return {
      success: true,
      output: {
        articleId: data.articleId ?? null,
        title: data.title ?? null,
        authors: data.authors ?? [],
        regions: data.regions ?? [],
        publishDate: data.publishDate ?? null,
        assetClasses: data.assetClasses ?? [],
        topics: data.topics ?? [],
        issuer: data.issuer ?? null,
        lender: data.lender ?? null,
        sponsor: data.sponsor ?? null,
        articleBody: data.articleBody ?? null,
        attachments: data.attachments ?? [],
      },
    }
  },

  outputs: {
    articleId: { type: 'number', description: 'Credit news article ID', nullable: true },
    title: { type: 'string', description: 'Title', nullable: true },
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
    publishDate: {
      type: 'string',
      description: 'Publication timestamp (ISO 8601)',
      nullable: true,
    },
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
      properties: {
        pbId: { type: 'string', description: 'PitchBook entity ID' },
        name: { type: 'string', description: 'Name' },
      },
    },
    lender: { type: 'json', description: 'Lender the article is about', nullable: true },
    sponsor: { type: 'json', description: 'Sponsor the article is about', nullable: true },
    articleBody: { type: 'string', description: 'Full text of the article', nullable: true },
    attachments: {
      type: 'array',
      description: 'Attachments on the article',
      items: { type: 'json' },
    },
  },
}
