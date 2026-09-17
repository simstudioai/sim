import type {
  CodaDocAnalyticsItem,
  CodaListDocAnalyticsParams,
  CodaListDocAnalyticsResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  ICON_PROPERTIES,
  joinListParam,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

const DOC_METRIC_KEYS = [
  'views',
  'copies',
  'likes',
  'sessionsMobile',
  'sessionsDesktop',
  'sessionsOther',
  'totalSessions',
  'aiCreditsChat',
  'aiCreditsBlock',
  'aiCreditsColumn',
  'aiCreditsAssistant',
  'aiCreditsReviewer',
  'aiCredits',
] as const

interface RawDocAnalyticsItem {
  doc: {
    id: string
    title: string
    href: string
    browserLink: string
    icon?: { name?: string; type?: string; browserLink?: string }
    createdAt?: string
    publishedAt?: string
  }
  metrics?: Array<Record<string, unknown> & { date?: string }>
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export const codaListDocAnalyticsTool: ToolConfig<
  CodaListDocAnalyticsParams,
  CodaListDocAnalyticsResponse
> = {
  id: 'coda_list_doc_analytics',
  name: 'Coda List Doc Analytics',
  description:
    'Get per-day or cumulative analytics (views, copies, likes, sessions by device, AI credits) for Coda docs',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Doc IDs to fetch analytics for, as an array or comma-separated list',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include docs in this workspace',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term used to filter docs',
    },
    isPublished: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include published docs',
    },
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
    scale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aggregation: "daily" (default) or "cumulative"',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: date, docId, title, createdAt, publishedAt, likes, copies, views, sessionsDesktop, sessionsMobile, sessionsOther, totalSessions, or an aiCredits field',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: "ascending" or "descending"',
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
      buildCodaUrl('/analytics/docs', {
        docIds: joinListParam(params.docIds, 'docIds'),
        workspaceId: optionalTrimmed(params.workspaceId),
        query: optionalTrimmed(params.query),
        isPublished: params.isPublished,
        sinceDate: optionalTrimmed(params.sinceDate),
        untilDate: optionalTrimmed(params.untilDate),
        scale: params.scale,
        orderBy: params.orderBy,
        direction: params.direction,
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawDocAnalyticsItem[]
      nextPageToken?: string
    }
    const items: CodaDocAnalyticsItem[] = (data.items ?? []).map((item) => ({
      doc: {
        id: item.doc.id,
        title: item.doc.title,
        href: item.doc.href,
        browserLink: item.doc.browserLink,
        icon: item.doc.icon
          ? {
              name: item.doc.icon.name ?? null,
              type: item.doc.icon.type ?? null,
              browserLink: item.doc.icon.browserLink ?? null,
            }
          : null,
        createdAt: item.doc.createdAt ?? null,
        publishedAt: item.doc.publishedAt ?? null,
      },
      metrics: (item.metrics ?? []).map((metric) => {
        const projected: Record<string, string | number | null> = { date: metric.date ?? null }
        for (const key of DOC_METRIC_KEYS) projected[key] = toNumberOrNull(metric[key])
        return projected
      }),
    }))
    return { success: true, output: { items, nextPageToken: data.nextPageToken || null } }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Analytics per doc',
      items: {
        type: 'object',
        properties: {
          doc: {
            type: 'object',
            description: 'Doc the metrics belong to',
            properties: {
              id: { type: 'string', description: 'Doc ID' },
              title: { type: 'string', description: 'Doc title' },
              href: { type: 'string', description: 'API link to the doc' },
              browserLink: { type: 'string', description: 'Browser link to the doc' },
              icon: {
                type: 'object',
                description: 'Doc icon',
                optional: true,
                properties: ICON_PROPERTIES,
              },
              createdAt: { type: 'string', description: 'Doc creation time', optional: true },
              publishedAt: { type: 'string', description: 'Doc publish time', optional: true },
            },
          },
          metrics: {
            type: 'array',
            description: 'Metrics per date',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date of the data (YYYY-MM-DD)' },
                views: { type: 'number', description: 'Doc views', optional: true },
                copies: { type: 'number', description: 'Doc copies', optional: true },
                likes: { type: 'number', description: 'Doc likes', optional: true },
                sessionsMobile: {
                  type: 'number',
                  description: 'Unique mobile visitors',
                  optional: true,
                },
                sessionsDesktop: {
                  type: 'number',
                  description: 'Unique desktop visitors',
                  optional: true,
                },
                sessionsOther: {
                  type: 'number',
                  description: 'Unique visitors on other devices',
                  optional: true,
                },
                totalSessions: {
                  type: 'number',
                  description: 'Sessions across all devices',
                  optional: true,
                },
                aiCreditsChat: {
                  type: 'number',
                  description: 'AI credits used by chat',
                  optional: true,
                },
                aiCreditsBlock: {
                  type: 'number',
                  description: 'AI credits used by AI blocks',
                  optional: true,
                },
                aiCreditsColumn: {
                  type: 'number',
                  description: 'AI credits used by AI columns',
                  optional: true,
                },
                aiCreditsAssistant: {
                  type: 'number',
                  description: 'AI credits used by the assistant',
                  optional: true,
                },
                aiCreditsReviewer: {
                  type: 'number',
                  description: 'AI credits used by the reviewer',
                  optional: true,
                },
                aiCredits: { type: 'number', description: 'Total AI credits used', optional: true },
              },
            },
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
