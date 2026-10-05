import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toArray, toRecordOrNull } from '@sim/utils/object'
import type { OutputProperty, ToolConfig } from '@/tools/types'
import type { YouComDomainFilterParams, YouComResearchSource } from '@/tools/youcom/types'

export const YOUCOM_INDEX_BASE_URL = 'https://ydc-index.io/v1'
export const YOUCOM_API_BASE_URL = 'https://api.you.com/v1'

/**
 * Languages the Answer endpoint accepts. Search also accepts ZH-HANS, ZH-HANT, JA, PT-BR, and
 * PT-PT; Answer rejects those, so a value carried over from Search is dropped instead of sent.
 */
export const ANSWER_LANGUAGES: ReadonlySet<string> = new Set([
  'AR',
  'EU',
  'BN',
  'BG',
  'CA',
  'HR',
  'CS',
  'DA',
  'NL',
  'EN',
  'EN-GB',
  'ET',
  'FI',
  'FR',
  'GL',
  'DE',
  'EL',
  'GU',
  'HE',
  'HI',
  'HU',
  'IS',
  'IT',
  'KN',
  'KO',
  'LV',
  'LT',
  'MS',
  'ML',
  'MR',
  'NB',
  'PL',
  'PA',
  'RO',
  'RU',
  'SR',
  'SK',
  'SL',
  'ES',
  'SV',
  'TA',
  'TE',
  'TH',
  'TR',
  'UK',
  'VI',
])

/** Effort levels the Finance Research endpoint accepts; others fall back to its `deep` default. */
export const FINANCE_RESEARCH_EFFORTS: ReadonlySet<string> = new Set(['deep', 'exhaustive'])

export const youComApiKeyParam = {
  type: 'string',
  required: true,
  visibility: 'user-only',
  description: 'You.com API key',
} as const satisfies ToolConfig['params'][string]

export function youComHeaders(params: { apiKey: string }): Record<string, string> {
  return {
    'X-API-Key': params.apiKey,
    'Content-Type': 'application/json',
  }
}

/** Reads an optional numeric param, treating empty and non-numeric values as unset. */
export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/** Normalizes a country or language code to You.com's uppercase enum form (`de` → `DE`). */
export function toCode(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase()
  return code || undefined
}

/**
 * Accepts a list from an upstream block (an array) or the UI (a comma- or
 * newline-separated string) and returns trimmed, non-empty entries.
 */
export function parseList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const raw = Array.isArray(value) ? value.map(String) : String(value).split(/[,\n]/)
  const items = raw.map((item) => item.trim()).filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Builds the `include_domains` / `exclude_domains` / `boost_domains` slice. You.com rejects
 * `include_domains` combined with either of the others with a bare "invalid request parameter(s)"
 * 422, so the combination is rejected here with an actionable message instead.
 */
export function buildDomainFilters(params: YouComDomainFilterParams): Record<string, string[]> {
  const filters: Record<string, string[]> = {}
  const include = parseList(params.includeDomains)
  const exclude = parseList(params.excludeDomains)
  const boost = parseList(params.boostDomains)
  if (include && (exclude || boost)) {
    throw new Error('Include domains cannot be combined with exclude or boost domains')
  }
  if (include) filters.include_domains = include
  if (exclude) filters.exclude_domains = exclude
  if (boost) filters.boost_domains = boost
  return filters
}

/**
 * Normalizes a JSON Schema supplied through the UI, where it arrives as a string, or through an
 * upstream block, where it is already an object.
 */
export function parseJsonSchema(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (isRecordLike(value)) return value
  if (typeof value !== 'string') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid output schema: ${getErrorMessage(error)}`)
  }
  if (!isRecordLike(parsed)) throw new Error('Invalid output schema: must be a JSON object')
  return parsed
}

export function mapResearchSources(sources: unknown): YouComResearchSource[] {
  return toArray(sources).map((source) => {
    const record = toRecordOrNull(source) ?? {}
    return {
      url: String(record.url ?? ''),
      title: typeof record.title === 'string' ? record.title : null,
      snippets: toArray(record.snippets).map(String),
    }
  })
}

/**
 * Source and warning outputs every research endpoint returns. Spread into `outputs` at the top
 * level so the docs generator, which reads tool source, can follow it.
 */
export const RESEARCH_SOURCE_OUTPUTS = {
  sources: {
    type: 'array',
    description: 'Web sources used to generate the answer',
    items: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL of the source webpage' },
        title: { type: 'string', description: 'Title of the source webpage', nullable: true },
        snippets: {
          type: 'array',
          description: 'Excerpts from the source used to generate the answer',
          items: { type: 'string' },
        },
      },
    },
  },
  warnings: {
    type: 'array',
    description: 'Warnings raised during research, such as source access issues or partial results',
    items: { type: 'string' },
  },
} as const satisfies Record<string, OutputProperty>

/** Answer outputs shared by Research and Get Research Task; null until an answer exists. */
export const RESEARCH_ANSWER_OUTPUTS = {
  content: {
    type: 'json',
    description:
      'Markdown answer with numbered inline citations, or an object matching the output schema when one was supplied',
    nullable: true,
  },
  contentType: {
    type: 'string',
    description: 'Format of content: text (Markdown) or object (structured output)',
    nullable: true,
  },
  ...RESEARCH_SOURCE_OUTPUTS,
} as const satisfies Record<string, OutputProperty>
