export const OUTBOX_PROCESSOR_MAX_RUNTIME_MS = 760_000
export const OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS = 770_000
export const OUTBOX_PROCESSOR_MAX_DURATION_SECONDS = 900
export const OUTBOX_PROCESSOR_INTERVAL_MS = 60_000
/** Allow every scheduled tick to start even when earlier workers use their full execution window. */
export const OUTBOX_PROCESSOR_CONCURRENCY = Math.ceil(
  (OUTBOX_PROCESSOR_MAX_DURATION_SECONDS * 1000) / OUTBOX_PROCESSOR_INTERVAL_MS
)
