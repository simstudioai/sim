import { createHash } from 'node:crypto'
import { generateId } from '@sim/utils/id'
import { sortObjectKeysDeep } from '@sim/utils/object'
import { z } from 'zod'
import {
  addSourcePagePayloadBytes,
  ConnectorSyncCapacityError,
} from '@/lib/knowledge/connectors/sync-primitives'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const checkpointSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string().length(64),
  generationId: z.string().min(1),
  startedAt: z.string().datetime(),
  cursor: z
    .string()
    .max(512 * 1024)
    .nullable(),
  complete: z.boolean(),
  listedCount: z.number().int().nonnegative(),
  unsafe: z.boolean(),
  contentFailures: z.boolean().default(false),
  changeCursor: z
    .string()
    .max(512 * 1024)
    .nullable(),
  incrementalSince: z.string().datetime().nullable(),
  forceRehydrate: z.boolean(),
  fullSync: z.boolean().default(false),
})

export type ListingCheckpoint = z.infer<typeof checkpointSchema>

/** Scope identity makes a stored cursor unusable after configuration, credential, or mode changes. */
export function listingFingerprint(scope: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortObjectKeysDeep(scope)))
    .digest('hex')
}

export function readListingCheckpoint(
  value: unknown,
  fingerprint: string
): ListingCheckpoint | null {
  const parsed = checkpointSchema.safeParse(value)
  return parsed.success && parsed.data.fingerprint === fingerprint ? parsed.data : null
}

export function beginListingCheckpoint(input: {
  fingerprint: string
  generationId: string
  startedAt: Date
  changeCursor?: string
  incrementalSince?: Date
  forceRehydrate?: boolean
  fullSync?: boolean
}): ListingCheckpoint {
  return {
    version: 1,
    fingerprint: input.fingerprint,
    generationId: input.generationId,
    startedAt: input.startedAt.toISOString(),
    cursor: null,
    complete: false,
    listedCount: 0,
    unsafe: false,
    contentFailures: false,
    changeCursor: input.changeCursor ?? null,
    incrementalSince: input.incrementalSince?.toISOString() ?? null,
    forceRehydrate: input.forceRehydrate ?? false,
    fullSync: input.fullSync ?? false,
  }
}

/**
 * Persists one provider page only after its documents and observations land.
 * A crash replays at most that page; EOF is durable so reconciliation can resume
 * independently. Runtime caches and access tokens never enter the checkpoint.
 */
export async function runResumableListing(input: {
  connectorConfig: Pick<ConnectorConfig, 'listDocuments' | 'isListingCursorInvalidError'>
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  checkpoint: ListingCheckpoint
  deadlineAt: number
  maxPages?: number
  beforePage: () => Promise<void>
  getAccessToken: (page: number) => Promise<string>
  /** False retains this page's cursor after a bounded amount of durable work. */
  processPage: (
    documents: ExternalDocument[],
    checkpoint: ListingCheckpoint
  ) => Promise<undefined | boolean>
  saveCheckpoint: (checkpoint: ListingCheckpoint) => Promise<void>
}): Promise<ListingCheckpoint> {
  let checkpoint = input.checkpoint
  let restartedExpiredCursor = false
  const cursors = new Set<string>()
  if (checkpoint.cursor) cursors.add(checkpoint.cursor)
  for (let page = 0; !checkpoint.complete && page < (input.maxPages ?? 25); page++) {
    await input.beforePage()
    if (Date.now() >= input.deadlineAt) break
    input.syncContext.syncRunId = checkpoint.generationId
    input.syncContext.totalDocsFetched = checkpoint.listedCount
    let response: ExternalDocumentList
    try {
      response = await input.connectorConfig.listDocuments(
        await input.getAccessToken(page),
        input.sourceConfig,
        checkpoint.cursor ?? undefined,
        input.syncContext,
        checkpoint.incrementalSince ? new Date(checkpoint.incrementalSince) : undefined
      )
    } catch (error) {
      if (
        !checkpoint.cursor ||
        restartedExpiredCursor ||
        input.connectorConfig.isListingCursorInvalidError?.(error) !== true
      )
        throw error
      checkpoint = {
        ...checkpoint,
        generationId: generateId(),
        startedAt: new Date().toISOString(),
        cursor: null,
        complete: false,
        listedCount: 0,
        unsafe: false,
        contentFailures: false,
      }
      await input.saveCheckpoint(checkpoint)
      cursors.clear()
      restartedExpiredCursor = true
      continue
    }
    if (response.documents.length > 50_000)
      throw new ConnectorSyncCapacityError('Connector returned an oversized document page')
    addSourcePagePayloadBytes(0, response.documents)
    if (response.hasMore && (!response.nextCursor || cursors.has(response.nextCursor))) {
      throw new Error('Connector pagination did not advance; retry or restart the listing')
    }
    if (response.nextCursor && response.nextCursor.length > 512 * 1024) {
      throw new ConnectorSyncCapacityError('Connector returned an oversized listing cursor')
    }
    checkpoint.unsafe ||=
      response.reconciliationSafe === false ||
      Boolean(
        input.syncContext.listingCapped ||
          input.syncContext.listingTruncated ||
          input.syncContext.reconciliationUnsafe
      )
    if ((await input.processPage(response.documents, checkpoint)) === false) {
      await input.saveCheckpoint(checkpoint)
      break
    }
    const next: ListingCheckpoint = {
      ...checkpoint,
      cursor: response.nextCursor ?? null,
      complete: !response.hasMore,
      listedCount: checkpoint.listedCount + response.documents.length,
    }
    await input.saveCheckpoint(next)
    checkpoint = next
    if (checkpoint.cursor) cursors.add(checkpoint.cursor)
  }
  return checkpoint
}
