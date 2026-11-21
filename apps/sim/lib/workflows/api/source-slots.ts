import type { NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api/server/routes'
import type { JsonErrorResponseDescriptor } from '@/lib/api/server/routes/types'
import type { ApplicationOperation, AuthorizingUseCase } from '@/lib/core/application'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Source requests of one lane this server process runs at once. Plans have a lane of their own,
 * so a read-role caller asking for a status never takes a slot an apply needs, and the editor's
 * Code tab reads in its own, so API and CLI gets and the editor never starve each other. A table
 * plan inside one slot may run a few workflow reads at once (`kinds/table`), so the bound is per
 * request, not per workflow load.
 */
const SOURCE_LANES = {
  read: { max: 4, noun: 'gets' },
  editor: { max: 4, noun: 'Code tab reads' },
  plan: { max: 4, noun: 'plans' },
  apply: { max: 4, noun: 'applies' },
} as const

type SourceLane = keyof typeof SOURCE_LANES

const runningSourceRequests: Record<SourceLane, number> = { read: 0, editor: 0, plan: 0, apply: 0 }

/** The wait a request refused for want of a slot is told to take. */
const SOURCE_BUSY_HEADERS = { 'Retry-After': '5' }

/** A source request refused because this process already runs as many as it may. */
class SourceSlotBusyError extends Error {
  constructor(readonly lane: SourceLane) {
    super(
      `This server is already running ${SOURCE_LANES[lane].max} source ${SOURCE_LANES[lane].noun}; retry shortly.`
    )
    this.name = 'SourceSlotBusyError'
  }
}

/**
 * `useCase`, run in one of its lane's slots (`laneOf`, or the lane it picks for the input): a get,
 * plan or apply (each holds a workflow's or a directory's worth of text, stored state and
 * canonical forms in memory) waits for nothing, and is refused with a `429` (see
 * {@link renderSourceSlotBusy}) when the process already runs {@link SOURCE_LANES}
 * of them, so a burst cannot run the process out of memory.
 */
export function withSourceSlot<O extends ApplicationOperation, I, R>(
  useCase: AuthorizingUseCase<O, I, R>,
  laneOf: SourceLane | ((input: I) => SourceLane)
): AuthorizingUseCase<O, I, R> {
  return {
    ...useCase,
    async execute(args) {
      const lane = typeof laneOf === 'function' ? laneOf(args.input) : laneOf
      if (runningSourceRequests[lane] >= SOURCE_LANES[lane].max) {
        throw new SourceSlotBusyError(lane)
      }
      runningSourceRequests[lane] += 1
      try {
        return await useCase.execute(args)
      } finally {
        runningSourceRequests[lane] -= 1
      }
    },
  }
}

/**
 * The lane of a source apply route that also serves dry runs: a dry run writes nothing and runs
 * what a plan runs, so it takes a plan slot and never one a real apply needs.
 */
export function applyOrDryRunLane(input: { dryRun?: boolean }): SourceLane {
  return input.dryRun ? 'plan' : 'apply'
}

/** A request {@link withSourceSlot} refused, as `429` with `Retry-After`; `null` for any other error. */
export function renderSourceSlotBusy(error: unknown): NextResponse | null {
  if (!(error instanceof SourceSlotBusyError)) return null
  return v2Error('RATE_LIMITED', error.message, { headers: SOURCE_BUSY_HEADERS })
}

/** {@link renderSourceSlotBusy} for an internal route. */
export function projectInternalSourceSlotBusy(error: unknown): JsonErrorResponseDescriptor | null {
  if (!(error instanceof SourceSlotBusyError)) return null
  return internalErrorResponse(429, { error: error.message }, SOURCE_BUSY_HEADERS)
}
