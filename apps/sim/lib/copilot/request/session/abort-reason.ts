/**
 * Abort-reason vocabulary for Sim-originated cancellations.
 *
 * This is deliberately a zero-dependency module (no OTel, no logger,
 * no DB) so it can be imported from both the telemetry layer
 * (`request/otel.ts`) and the abort layer (`request/session/abort.ts`)
 * without creating a circular dependency. The longer prose lives in
 * `abort.ts`; anything here is the raw classification vocabulary
 * consumed by span-status / finalizer code.
 */

/**
 * Reason strings passed to `AbortController.abort(reason)` for every
 * Sim-originated cancel path.
 */
export const AbortReason = {
  /** Same-process stop: browser→Sim→abortActiveStream. */
  UserStop: 'user_stop:abortActiveStream',
  /**
   * Cross-process stop: the Sim node that holds the SSE didn't
   * receive the Stop HTTP call, but it polled the Redis abort marker
   * that the node that DID receive it wrote, and aborts on the poll.
   */
  RedisPoller: 'redis_abort_marker:poller',
  /** Internal timeout on the outbound explicit-abort fetch to Go. */
  ExplicitAbortFetchTimeout: 'timeout:go_explicit_abort_fetch',
} as const

export type AbortReasonValue = (typeof AbortReason)[keyof typeof AbortReason]

/**
 * True iff `reason` indicates the user explicitly triggered the abort
 * (as opposed to an implicit client disconnect or server timeout).
 * Treated as a small closed vocabulary — any string not in
 * `AbortReason` is presumed non-explicit. This is the canonical
 * "should I treat this cancellation as expected?" predicate: span
 * status-setters consult it to suppress ERROR only for user-initiated
 * stops, mirroring `requestctx.IsExplicitUserStop` on the Go side.
 */
export function isExplicitStopReason(reason: unknown): boolean {
  return reason === AbortReason.UserStop || reason === AbortReason.RedisPoller
}
