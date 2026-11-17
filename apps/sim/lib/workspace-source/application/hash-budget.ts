/**
 * What one request (a get, or one apply round) may download to hash stored bytes whose hash
 * nothing records: workspace files and knowledge base documents share one budget, so the bound
 * holds for the request, not per kind. Past it, a resource stays unhashed and is listed or planned
 * as such.
 */
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { SourceContext } from '@/lib/workspace-source/application/types'

/** Downloads a request may hash, beside the byte bound. */
const MAX_HASHED_PER_REQUEST = 200

/** A request's remaining hashing budget; created once per request and shared by every copy of its context. */
export interface HashBudget {
  bytes: number
  count: number
}

export function newHashBudget(): HashBudget {
  return { bytes: WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest, count: MAX_HASHED_PER_REQUEST }
}

/** Takes one download of `bytes` from the request's budget, or returns `false` when it does not fit. */
export function spendHash(ctx: SourceContext, bytes: number): boolean {
  const budget = ctx.hashBudget
  if (budget.count <= 0 || bytes > budget.bytes) return false
  budget.bytes -= bytes
  budget.count -= 1
  return true
}
