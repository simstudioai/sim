import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { SEARCH_STATS_PERIODS, SEARCH_STATS_SURFACES } from '@/lib/knowledge/search/stats'

export const organizationSearchStatsParsers = {
  period: parseAsStringLiteral(SEARCH_STATS_PERIODS).withDefault('30d'),
  /** An absent surface includes every Search entry point. */
  surface: parseAsStringLiteral(SEARCH_STATS_SURFACES),
  startDate: parseAsString,
  endDate: parseAsString,
}

export const organizationSearchStatsUrlOptions = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: {
    period: 'stats-period',
    surface: 'stats-surface',
    startDate: 'stats-start',
    endDate: 'stats-end',
  },
} as const
