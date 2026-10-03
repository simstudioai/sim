import type {
  SemrushDomainVsDomainParams,
  SemrushDomainVsDomainResponse,
  SemrushDomainVsDomainRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReportWithHeader,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const MAX_COMPARED_DOMAINS = 5

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARED_DOMAINS)
}

/**
 * The report keys each compared domain by a positional `P0`..`P4` column, and
 * the CSV header carries the domain the position belongs to, so the requested
 * column list has to track the number of domains actually submitted.
 */
function buildColumns(domainCount: number): string[] {
  const positions = Array.from({ length: domainCount }, (_, index) => `P${index}`)
  return ['Ph', ...positions, 'Co', 'Nq', 'Cp']
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Header labels of the trailing metric columns, in the order they are asked for.
 * They mark where the per-domain position columns stop: the compared domains are
 * whatever sits between the keyword column and the first metric, so a position
 * column the API omits shortens that run instead of pushing a metric into it.
 */
const METRIC_COLUMNS = [
  { label: 'competition', key: 'competition' },
  { label: 'search volume', key: 'searchVolume' },
  { label: 'cpc', key: 'cpc' },
] as const

type MetricKey = (typeof METRIC_COLUMNS)[number]['key']

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Locates each metric column by its own header, leaving an absent one unmapped. */
function indexMetrics(headers: string[]): {
  firstMetricIndex: number
  metricIndexes: Partial<Record<MetricKey, number>>
} {
  const labels = headers.map(normalizeLabel)
  const metricIndexes: Partial<Record<MetricKey, number>> = {}
  let firstMetricIndex = headers.length

  for (const { label, key } of METRIC_COLUMNS) {
    const index = labels.indexOf(label)
    if (index === -1) continue
    metricIndexes[key] = index
    firstMetricIndex = Math.min(firstMetricIndex, index)
  }
  return { firstMetricIndex, metricIndexes }
}

export const semrushDomainVsDomainTool: ToolConfig<
  SemrushDomainVsDomainParams,
  SemrushDomainVsDomainResponse
> = {
  id: 'semrush_domain_vs_domain',
  name: 'Semrush Domain vs. Domain',
  description:
    'Compare up to five domains on the keywords they rank for, returning each domain position side by side.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    domains: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of up to five domains to compare',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Regional database code, for example us, uk, de, or fr',
    },
    competitionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Which keyword set to compare: or for organic or ad for paid',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return, capped at 100,000',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip, for pagination',
    },
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example nq_desc or cp_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|Nq|Gt|1000',
    },
  },

  request: {
    url: (params) => {
      const domains = parseDomains(params.domains)
      const type = params.competitionType === 'ad' ? 'ad' : 'or'

      return buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_domains',
        columnCodes: buildColumns(domains.length),
        extra: {
          domains: domains.map((domain) => `*|${type}|${domain}`).join('|'),
          database: params.database,
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_sort: params.displaySort,
          display_filter: params.displayFilter,
        },
      })
    },
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const { headers, rows } = await readSemrushReportWithHeader(response)
    const { firstMetricIndex, metricIndexes } = indexMetrics(headers)
    const comparedDomains = headers.slice(1, firstMetricIndex)

    const keywords: SemrushDomainVsDomainRow[] = rows.map((values) => {
      const positions: Record<string, number | null> = {}
      comparedDomains.forEach((domain, index) => {
        positions[domain] = toNumber(values[1 + index])
      })

      const metric = (key: MetricKey) => {
        const index = metricIndexes[key]
        return index === undefined ? null : toNumber(values[index])
      }

      return {
        keyword: values[0]?.trim() || null,
        positions,
        competition: metric('competition'),
        searchVolume: metric('searchVolume'),
        cpc: metric('cpc'),
      }
    })

    return {
      success: true,
      output: {
        domains: comparedDomains,
        keywords,
      },
    }
  },

  outputs: {
    domains: {
      type: 'array',
      description: 'The compared domains, in the order their positions appear',
      items: { type: 'string' },
    },
    keywords: {
      type: 'array',
      description: 'Keywords with each compared domain position',
      items: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keyword phrase',
            nullable: true,
          },
          positions: {
            type: 'json',
            description:
              'Position of each compared domain, keyed by domain, where 0 means not ranked',
          },
          competition: {
            type: 'number',
            description: 'Competitive density of advertisers bidding on the keyword (0-1)',
            nullable: true,
          },
          searchVolume: {
            type: 'number',
            description: 'Average monthly searches for the keyword',
            nullable: true,
          },
          cpc: {
            type: 'number',
            description: 'Average cost per click in USD (Google Ads)',
            nullable: true,
          },
        },
      },
    },
  },
}
