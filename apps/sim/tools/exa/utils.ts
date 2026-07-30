import type { ExaFreshnessParams } from '@/tools/exa/types'

/** Splits a comma-separated user string into a trimmed, non-empty list. */
export function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Categories Exa retired when it reworked the taxonomy, mapped onto their
 * current equivalents. Exa accepts `category` as an unvalidated soft hint, so a
 * stale value never errors — it just stops steering results. Remapping keeps
 * workflows saved against the old dropdown working as their authors intended.
 * Values with no modern equivalent (`pdf`, `github`, `tweet`, `movie`, `song`)
 * are passed through untouched.
 */
const LEGACY_CATEGORIES: Record<string, string> = {
  research_paper: 'publication',
  'research paper': 'publication',
  news_article: 'news',
  'news article': 'news',
  personal_site: 'personal site',
  financial_report: 'financial report',
  linkedin_profile: 'people',
  'linkedin profile': 'people',
}

export function resolveCategory(category: string | undefined): string | undefined {
  if (!category) return undefined
  return LEGACY_CATEGORIES[category.toLowerCase()] ?? category
}

/**
 * Applies Exa's content-freshness controls to a request slice.
 *
 * Exa rejects a request that carries both `livecrawl` and `maxAgeHours` with a
 * 400 (`Cannot set both 'livecrawl' and 'maxAgeHours'`), so exactly one may be
 * sent. `maxAgeHours` is the current control and wins; `livecrawl` is kept only
 * so workflows saved before the deprecation keep running unchanged.
 */
export function applyFreshness(target: Record<string, any>, params: ExaFreshnessParams): void {
  const maxAgeHours = params.maxAgeHours
  const hasMaxAgeHours =
    maxAgeHours !== undefined && maxAgeHours !== null && String(maxAgeHours).trim() !== ''

  if (hasMaxAgeHours) {
    target.maxAgeHours = Number(maxAgeHours)
  } else if (params.livecrawl) {
    target.livecrawl = params.livecrawl
  }

  if (params.livecrawlTimeout !== undefined && String(params.livecrawlTimeout).trim() !== '') {
    target.livecrawlTimeout = Number(params.livecrawlTimeout)
  }
}

/**
 * Normalizes a JSON Schema supplied through the UI, where it arrives as a
 * string, or through an upstream block, where it is already an object.
 */
export function parseJsonSchema(value: unknown, label: string): Record<string, any> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'object') return value as Record<string, any>
  if (typeof value !== 'string') return undefined

  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('schema must be a JSON object')
    }
    return parsed as Record<string, any>
  } catch (error) {
    throw new Error(`Invalid ${label}: ${(error as Error).message}`)
  }
}

/** Builds the `extras` slice, omitted entirely when nothing was requested. */
export function buildExtras(params: {
  extrasLinks?: number
  extrasImageLinks?: number
}): Record<string, number> | undefined {
  const extras: Record<string, number> = {}
  if (params.extrasLinks) extras.links = Number(params.extrasLinks)
  if (params.extrasImageLinks) extras.imageLinks = Number(params.extrasImageLinks)
  return Object.keys(extras).length > 0 ? extras : undefined
}

/** Reads `costDollars.total`, which Exa returns on every billable response. */
export function requireCostTotal(output: Record<string, any>, toolName: string): number {
  const costDollars = output.__costDollars as { total?: number } | undefined
  if (costDollars?.total == null) {
    throw new Error(`Exa ${toolName} response missing costDollars field`)
  }
  return costDollars.total
}
