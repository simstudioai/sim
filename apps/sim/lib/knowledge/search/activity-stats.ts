import { dbReplica } from '@sim/db'
import { organizationSearchInvocation, user } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import {
  getSearchStatsWindow,
  SEARCH_STATS_PEOPLE_LIMIT,
  type SEARCH_STATS_PERIODS,
  SEARCH_STATS_SOURCE_LIMIT,
  type SEARCH_STATS_SURFACES,
  type SearchStatsDateRange,
} from '@/lib/knowledge/search/stats'

export interface SearchStatsInput extends SearchStatsDateRange {
  organizationId: string
  period: (typeof SEARCH_STATS_PERIODS)[number]
  surface?: (typeof SEARCH_STATS_SURFACES)[number]
}

type StatsRow = {
  totals: { invocations: number; activePeople: number; results: number }
  series: { timestamp: string; invocations: number }[]
  surfaces: { surface: (typeof SEARCH_STATS_SURFACES)[number]; invocations: number }[]
  sources: { sourceType: string; invocations: number }[]
  people: {
    userId: string | null
    name: string | null
    email: string | null
    invocations: number
    sourceTypes: string[]
  }[]
}

/** One statement snapshot; only bounded aggregates leave Postgres, never individual search records. */
export async function loadOrganizationSearchStats(input: SearchStatsInput, now = new Date()) {
  const { start, end, days } = getSearchStatsWindow(input.period, now, input)
  const rows = await dbReplica.transaction(
    async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      return tx.execute<StatsRow>(sql`
    WITH activity AS (
      SELECT id, user_id, surface, source_types, result_count, created_at
      FROM ${organizationSearchInvocation}
      WHERE organization_id = ${input.organizationId}
        AND created_at >= ${start.toISOString()}::timestamptz
        AND created_at < ${end.toISOString()}::timestamptz
        ${input.surface ? sql`AND surface = ${input.surface}` : sql``}
    ), people AS (
      SELECT user_id, count(*)::float8 AS invocations
      FROM activity GROUP BY user_id
      ORDER BY invocations DESC, user_id NULLS LAST
      LIMIT ${SEARCH_STATS_PEOPLE_LIMIT}
    )
    SELECT
      (SELECT jsonb_build_object(
        'invocations', count(*)::float8,
        'activePeople', count(DISTINCT user_id)::float8,
        'results', coalesce(sum(result_count), 0)::float8
      ) FROM activity) AS totals,
      (SELECT coalesce(jsonb_agg(row ORDER BY row.timestamp), '[]'::jsonb) FROM (
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T00:00:00.000Z' AS timestamp,
          count(*)::float8 AS invocations
        FROM activity GROUP BY 1
      ) row) AS series,
      (SELECT coalesce(jsonb_agg(row ORDER BY row.invocations DESC, row.surface), '[]'::jsonb) FROM (
        SELECT surface, count(*)::float8 AS invocations FROM activity GROUP BY surface
      ) row) AS surfaces,
      (SELECT coalesce(jsonb_agg(row ORDER BY row.invocations DESC, row."sourceType"), '[]'::jsonb) FROM (
        SELECT source_type AS "sourceType", count(*)::float8 AS invocations
        FROM activity CROSS JOIN LATERAL unnest(source_types) AS source_type
        GROUP BY source_type ORDER BY invocations DESC, source_type
        LIMIT ${SEARCH_STATS_SOURCE_LIMIT}
      ) row) AS sources,
      (SELECT coalesce(jsonb_agg(row ORDER BY row.invocations DESC, row."userId" NULLS LAST), '[]'::jsonb) FROM (
        SELECT people.user_id AS "userId", ${user.name} AS name, ${user.email} AS email,
          people.invocations,
          ARRAY(
            SELECT DISTINCT source_type FROM activity
            CROSS JOIN LATERAL unnest(source_types) AS source_type
            WHERE activity.user_id IS NOT DISTINCT FROM people.user_id
            ORDER BY source_type LIMIT ${SEARCH_STATS_SOURCE_LIMIT}
          ) AS "sourceTypes"
        FROM people LEFT JOIN ${user} ON ${user.id} = people.user_id
      ) row) AS people
    `)
    },
    { accessMode: 'read only' }
  )
  const row = rows[0]
  if (!row) throw new Error('Search activity aggregate returned no result')
  const byDay = new Map(row.series.map((point) => [point.timestamp, point.invocations]))
  return {
    ...row,
    start: start.toISOString(),
    end: end.toISOString(),
    series: Array.from({ length: days }, (_, index) => {
      const timestamp = new Date(start.getTime() + index * 86_400_000).toISOString()
      return { timestamp, invocations: byDay.get(timestamp) ?? 0 }
    }),
  }
}
