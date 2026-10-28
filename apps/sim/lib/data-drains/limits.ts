export const DATA_DRAIN_LIMITS = {
  pageRows: 100,
  maxRowBytes: 1024 * 1024,
  maxChunkBytes: 4 * 1024 * 1024,
  maxChunksPerRun: 100,
  maxRowsPerRun: 10_000,
  maxBytesPerRun: 100 * 1024 * 1024,
  softDurationMs: 20 * 60_000,
  hardDurationMs: 25 * 60_000,
} as const
