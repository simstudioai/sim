/** Shared serialized JSON limit for paused-snapshot migration and recovery. */
export const MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES = 16 * 1024 * 1024

/** Bounds fallback query cardinality alongside the shared per-snapshot byte filter. */
export const LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE = 4
