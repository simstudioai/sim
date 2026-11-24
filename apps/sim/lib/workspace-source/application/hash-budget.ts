/**
 * What one request (a get, or one apply) may download to hash stored bytes whose hash
 * nothing records: workspace files and knowledge base documents share one budget, so the bound
 * holds for the request, not per kind. Past it, a resource stays unhashed and is listed or planned
 * as such.
 */
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { SourceContext } from '@/lib/workspace-source/application/types'

/** Downloads a request may hash, beside the byte bound. */
const MAX_HASHED_PER_REQUEST = 200

/** A request's remaining hashing budget, shared by every copy of its context. */
export interface HashBudget {
  bytes: number
  count: number
}

/** A full hashing budget for one request. */
export function newHashBudget(): HashBudget {
  return { bytes: WORKSPACE_SOURCE_LIMITS.maxHashBytesPerRequest, count: MAX_HASHED_PER_REQUEST }
}

/** Downloads one plan or get runs at once while hashing. */
export const HASH_CONCURRENCY = 4

/**
 * Splits `items` into those the request's budget covers, spent in order so the outcome never
 * depends on download timing, and those it leaves unhashed.
 */
export function takeHashBudget<T>(
  ctx: SourceContext,
  items: Iterable<T>,
  sizeOf: (item: T) => number
): { taken: T[]; left: T[] } {
  const taken: T[] = []
  const left: T[] = []
  for (const item of items) (spendHash(ctx, sizeOf(item)) ? taken : left).push(item)
  return { taken, left }
}

/** Takes one download of `bytes` from the request's budget; `false` when it does not fit. */
export function spendHash(ctx: SourceContext, bytes: number): boolean {
  const budget = ctx.hashBudget
  if (budget.count <= 0 || bytes > budget.bytes) return false
  budget.bytes -= bytes
  budget.count -= 1
  return true
}
