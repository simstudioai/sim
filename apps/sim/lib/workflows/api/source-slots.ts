import type { NextResponse } from 'next/server'
import type { ApplicationOperation, AuthorizingUseCase } from '@/lib/core/application'
import { v2Error } from '@/app/api/v2/lib/response'

/**
 * Source requests of one lane this server process runs at once. Plans have a lane of their own,
 * so a read-role caller asking for a status never takes a slot an apply needs.
 */
const MAX_CONCURRENT_SOURCE_REQUESTS = { read: 4, plan: 4, apply: 4 } as const

type SourceLane = keyof typeof MAX_CONCURRENT_SOURCE_REQUESTS

const LANE_NOUNS: Record<SourceLane, string> = { read: 'gets', plan: 'plans', apply: 'applies' }

const runningSourceRequests: Record<SourceLane, number> = { read: 0, plan: 0, apply: 0 }

/** Seconds a request refused for want of a slot is told to wait. */
const SOURCE_BUSY_RETRY_AFTER_SECONDS = 5

/** A source request refused because this process already runs as many as it may. */
class SourceSlotBusyError extends Error {
  constructor(readonly lane: SourceLane) {
    super(
      `This server is already running ${MAX_CONCURRENT_SOURCE_REQUESTS[lane]} source ${LANE_NOUNS[lane]}; retry shortly.`
    )
    this.name = 'SourceSlotBusyError'
  }
}

/**
 * `useCase`, run in one of its lane's slots: a get, plan or apply (each holds a workflow's or a
 * directory's worth of text, stored state and canonical forms in memory) waits for nothing, and
 * is refused with a `429` (see {@link renderSourceSlotBusy}) when the process already runs
 * {@link MAX_CONCURRENT_SOURCE_REQUESTS} of them, so a burst cannot run the process out of memory.
 */
export function withSourceSlot<O extends ApplicationOperation, I, R>(
  useCase: AuthorizingUseCase<O, I, R>,
  lane: SourceLane
): AuthorizingUseCase<O, I, R> {
  return {
    ...useCase,
    async execute(args) {
      if (runningSourceRequests[lane] >= MAX_CONCURRENT_SOURCE_REQUESTS[lane]) {
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

/** A request {@link withSourceSlot} refused, as `429` with `Retry-After`; `null` for any other error. */
export function renderSourceSlotBusy(error: unknown): NextResponse | null {
  if (!(error instanceof SourceSlotBusyError)) return null
  return v2Error('RATE_LIMITED', error.message, {
    headers: { 'Retry-After': String(SOURCE_BUSY_RETRY_AFTER_SECONDS) },
  })
}
