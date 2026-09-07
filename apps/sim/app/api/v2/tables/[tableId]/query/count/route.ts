import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { v2QueryRowsCountContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { queryTableRows } from '@/lib/table/application/rows'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Counts the rows a predicate matches.
 *
 * The same `queryTableRows` read the paged endpoints use, asked for its total
 * instead of its page: `includeTotal` runs a COUNT over the full predicate view
 * (not the page's keyset window), and `limit: 1` keeps the row drain that runs
 * alongside it to a single row rather than a full default page.
 *
 * `totalCount` is `number | null` on the use-case result because callers may ask
 * for a page without a total. This route always asks for one, so a null here is
 * a broken invariant rather than a reachable outcome — it fails loudly instead
 * of being coerced into a plausible-looking zero.
 */
export const POST = defineV2JsonRoute({
  contract: v2QueryRowsCountContract,
  operation: tableOperations.queryRows,
  /** POST carries structured filters but performs a read-only query. */
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    predicate: body.predicate,
    limit: 1,
    includeTotal: true,
  }),
  useCase: queryTableRows,
  present: ({ totalCount }) => {
    if (totalCount === null) {
      throw new Error('Table row count requested with includeTotal but no total was computed')
    }
    return { data: { totalCount } }
  },
})
