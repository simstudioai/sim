import type {
  CodaListPageAnalyticsParams,
  CodaListPageAnalyticsResponse,
  CodaPageAnalyticsItem,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  DOC_ID_PARAM,
  ICON_PROPERTIES,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

const PAGE_METRIC_KEYS = [
  'views',
  'sessions',
  'users',
  'averageSecondsViewed',
  'medianSecondsViewed',
  'tabs',
] as const

interface RawPageAnalyticsItem {
  page: { id: string; name: string; icon?: { name?: string; type?: string; browserLink?: string } }
  metrics?: Array<Record<string, unknown> & { date?: string }>
}

export const codaListPageAnalyticsTool: ToolConfig<
  CodaListPageAnalyticsParams,
  CodaListPageAnalyticsResponse
> = {
  id: 'coda_list_page_analytics',
  name: 'Coda List Page Analytics',
  description:
    'Get daily analytics (views, sessions, users, time viewed) for each page of a Coda doc. Only available for docs in Enterprise workspaces.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include activity on or after this date (YYYY-MM-DD)',
    },
    untilDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include activity on or before this date (YYYY-MM-DD)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (1-5000, default 1000)',
    },
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('analytics', 'docs', [params.docId, 'docId'], 'pages'), {
        sinceDate: optionalTrimmed(params.sinceDate),
        untilDate: optionalTrimmed(params.untilDate),
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawPageAnalyticsItem[]
      nextPageToken?: string
    }
    const items: CodaPageAnalyticsItem[] = (data.items ?? []).map((item) => ({
      page: {
        id: item.page.id,
        name: item.page.name,
        icon: item.page.icon
          ? {
              name: item.page.icon.name ?? null,
              type: item.page.icon.type ?? null,
              browserLink: item.page.icon.browserLink ?? null,
            }
          : null,
      },
      metrics: (item.metrics ?? []).map((metric) => {
        const projected: Record<string, string | number | null> = { date: metric.date ?? null }
        for (const key of PAGE_METRIC_KEYS) {
          projected[key] = typeof metric[key] === 'number' ? (metric[key] as number) : null
        }
        return projected
      }),
    }))
    return { success: true, output: { items, nextPageToken: data.nextPageToken || null } }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Analytics per page',
      items: {
        type: 'object',
        properties: {
          page: {
            type: 'object',
            description: 'Page the metrics belong to',
            properties: {
              id: { type: 'string', description: 'Page ID' },
              name: { type: 'string', description: 'Page name' },
              icon: {
                type: 'object',
                description: 'Page icon',
                optional: true,
                properties: ICON_PROPERTIES,
              },
            },
          },
          metrics: {
            type: 'array',
            description: 'Metrics per date',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date of the data (YYYY-MM-DD)' },
                views: { type: 'number', description: 'Page views that day', optional: true },
                sessions: {
                  type: 'number',
                  description: 'Unique browsers that viewed the page',
                  optional: true,
                },
                users: {
                  type: 'number',
                  description: 'Unique Coda users that viewed the page',
                  optional: true,
                },
                averageSecondsViewed: {
                  type: 'number',
                  description: 'Average seconds the page was viewed',
                  optional: true,
                },
                medianSecondsViewed: {
                  type: 'number',
                  description: 'Median seconds the page was viewed',
                  optional: true,
                },
                tabs: {
                  type: 'number',
                  description: 'Unique tabs that opened the doc',
                  optional: true,
                },
              },
            },
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
