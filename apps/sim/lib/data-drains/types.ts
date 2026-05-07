import type { z } from 'zod'

export const SOURCE_TYPES = [
  'workflow_logs',
  'job_logs',
  'audit_logs',
  'copilot_chats',
  'copilot_runs',
] as const

export type SourceType = (typeof SOURCE_TYPES)[number]

export const DESTINATION_TYPES = ['s3', 'webhook'] as const

export type DestinationType = (typeof DESTINATION_TYPES)[number]

export const CADENCE_TYPES = ['hourly', 'daily'] as const

export type CadenceType = (typeof CADENCE_TYPES)[number]

export const RUN_TRIGGERS = ['cron', 'manual'] as const

export type RunTrigger = (typeof RUN_TRIGGERS)[number]

/**
 * Opaque, source-defined cursor. Stored as text in `data_drains.cursor` and
 * round-tripped untouched. Sources may encode timestamps, ULIDs, or composite
 * keys — the runner never inspects it.
 */
export type Cursor = string | null

export interface SourcePageInput {
  organizationId: string
  cursor: Cursor
  chunkSize: number
  signal: AbortSignal
}

export interface DrainSource<TRow = unknown> {
  readonly type: SourceType
  readonly displayName: string
  /**
   * Pages rows strictly newer than `cursor` in cursor-ascending order.
   * An empty iterator means no new rows.
   */
  pages(input: SourcePageInput): AsyncIterable<TRow[]>
  /** Stable JSON-safe shape sent to destinations. Public NDJSON contract. */
  serialize(row: TRow): Record<string, unknown>
  /** Returns the cursor that, when passed back, excludes `row` and everything before it. */
  cursorAfter(row: TRow): Cursor
}

export interface DeliveryMetadata {
  drainId: string
  runId: string
  source: SourceType
  /** 0-based chunk index within the run. */
  sequence: number
  rowCount: number
  /**
   * Wall-clock start of the run. Destinations that partition by date (e.g. S3
   * `YYYY/MM/DD` keys) should derive the partition from this so a single run
   * lands under one prefix even when delivery crosses a midnight boundary.
   */
  runStartedAt: Date
}

export interface DeliveryResult {
  /** Stable identifier for the written object: e.g. `s3://bucket/key` or `https://host/path`. */
  locator: string
}

export interface DrainDeliverySession {
  deliver(input: {
    body: Buffer
    contentType: 'application/x-ndjson'
    metadata: DeliveryMetadata
    signal: AbortSignal
  }): Promise<DeliveryResult>
  close(): Promise<void>
}

export interface DrainDestination<TConfig = unknown, TCredentials = unknown> {
  readonly type: DestinationType
  readonly displayName: string
  /** Validates non-secret config (bucket, region, prefix, url, ...) at the API boundary. */
  readonly configSchema: z.ZodType<TConfig>
  /** Validates secret payload separately so it can live in an encrypted column. */
  readonly credentialsSchema: z.ZodType<TCredentials>
  /** Optional reachability probe used by the "Test connection" UI button. */
  test?(input: { config: TConfig; credentials: TCredentials; signal: AbortSignal }): Promise<void>
  /**
   * Opens a delivery session for one drain run. Lets destinations amortize
   * expensive resources (S3Client, keep-alive connections) across all chunks
   * in a run instead of rebuilding per chunk. Caller must `close()` when done.
   */
  openSession(input: { config: TConfig; credentials: TCredentials }): DrainDeliverySession
}
