import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type FoldTableRowChangesResponse,
  foldTableRowChangesContract,
} from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server/validation'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { foldPendingTableRowChanges } from '@/lib/table/row-changes'

const logger = createLogger('FoldTableRowChangesApi')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Leaves the route's `maxDuration` room for a fold started at the deadline to finish. */
const FOLD_SWEEP_BUDGET_MS = 45_000

/**
 * Folds the table row-change log into each table's definition row. Each fold is one short
 * statement, so the sweep runs in the request; overlapping sweeps skip each other's tables.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Table row-change fold')
  if (authError) return authError

  const parsed = await parseRequest(foldTableRowChangesContract, request, {})
  if (!parsed.success) return parsed.response

  const result = await foldPendingTableRowChanges(FOLD_SWEEP_BUDGET_MS)
  logger.info('Table row-change fold sweep completed', { ...result })
  const body: FoldTableRowChangesResponse = { success: true, ...result }
  return NextResponse.json(body)
})
