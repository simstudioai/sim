import { db } from '@sim/db'
import { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled, isDataDrainsEnabled } from '@/lib/core/config/env-flags'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { decryptCredentials } from '@/lib/data-drains/encryption'
import { createCredentialErrorRedactor } from '@/lib/data-drains/errors'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import { getSource } from '@/lib/data-drains/sources/registry'
import type { Cursor, RunTrigger } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainsService')

export interface RunDrainResult {
  drainId: string
  runId: string
  status: 'success' | 'failed' | 'skipped'
  rowsExported: number
  bytesWritten: number
  cursorBefore: Cursor
  cursorAfter: Cursor
  locators: string[]
  hasMore: boolean
  error?: string
}

/**
 * Orchestrates one drain export. Source-/destination-agnostic — talks only to
 * the registry interfaces. Each provider acknowledgement checkpoints its cursor;
 * a crash between delivery and checkpoint can replay those rows, so consumers
 * dedupe on the per-row `id` field. A database claim fences concurrent workers.
 */
export async function runDrain(
  drainId: string,
  trigger: RunTrigger,
  options: { signal?: AbortSignal } = {}
): Promise<RunDrainResult> {
  const startedAt = new Date()
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(DATA_DRAIN_LIMITS.hardDurationMs),
  ])
  signal.throwIfAborted()
  const [snapshot] = await db
    .select({
      organizationId: dataDrains.organizationId,
      enabled: dataDrains.enabled,
      cursor: dataDrains.cursor,
    })
    .from(dataDrains)
    .where(eq(dataDrains.id, drainId))
    .limit(1)
  if (!snapshot) throw new Error(`Data drain not found: ${drainId}`)
  if (
    !snapshot.enabled ||
    (!isBillingEnabled && !isDataDrainsEnabled) ||
    (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(snapshot.organizationId)))
  ) {
    return {
      drainId,
      runId: '',
      status: 'skipped',
      rowsExported: 0,
      bytesWritten: 0,
      cursorBefore: snapshot.cursor,
      cursorAfter: snapshot.cursor,
      locators: [],
      hasMore: false,
    }
  }
  const runId = generateId()
  const claim = await db.transaction(async (tx) => {
    const [drain] = await tx
      .select()
      .from(dataDrains)
      .where(eq(dataDrains.id, drainId))
      .limit(1)
      .for('update')
    if (!drain) throw new Error(`Data drain not found: ${drainId}`)
    if (!drain.enabled) return { drain, claimed: false }
    const [running] = await tx
      .select({ id: dataDrainRuns.id })
      .from(dataDrainRuns)
      .where(and(eq(dataDrainRuns.drainId, drainId), eq(dataDrainRuns.status, 'running')))
      .limit(1)
    if (running) return { drain, claimed: false }
    signal.throwIfAborted()
    await tx.insert(dataDrainRuns).values({
      id: runId,
      drainId,
      status: 'running',
      trigger,
      startedAt,
      cursorBefore: drain.cursor,
      cursorAfter: drain.cursor,
    })
    await tx
      .update(dataDrains)
      .set({ lastRunAt: startedAt, updatedAt: startedAt })
      .where(eq(dataDrains.id, drainId))
    return { drain, claimed: true }
  })
  const { drain } = claim
  if (!claim.claimed) {
    return {
      drainId,
      runId: '',
      status: 'skipped',
      rowsExported: 0,
      bytesWritten: 0,
      cursorBefore: drain.cursor,
      cursorAfter: drain.cursor,
      locators: [],
      hasMore: false,
    }
  }

  const source = getSource(drain.source)
  const destination = getDestination(drain.destinationType)

  const cursorBefore = drain.cursor
  let cursor: Cursor = drain.cursor
  let checkpointCursor: Cursor = drain.cursor
  let rowsExported = 0
  let bytesWritten = 0
  let sequence = 0
  let hasMore = false
  const locators: string[] = []

  /**
   * Schema-parse and decrypt happen *after* the run row is created so failures
   * in either (e.g. encryption-key rotation, schema drift across versions)
   * surface as a `failed` run row in the UI rather than vanishing into the
   * background-job logs while `lastRunAt` quietly advances.
   */
  let session: ReturnType<typeof destination.openSession> | null = null
  let redactError = createCredentialErrorRedactor()

  async function checkpoint(status: 'running' | 'success'): Promise<void> {
    const now = new Date()
    await db.transaction(async (tx) => {
      const [currentDrain] = await tx
        .select({ cursor: dataDrains.cursor })
        .from(dataDrains)
        .where(eq(dataDrains.id, drainId))
        .limit(1)
        .for('update')
      const [currentRun] = await tx
        .select({ status: dataDrainRuns.status })
        .from(dataDrainRuns)
        .where(eq(dataDrainRuns.id, runId))
        .limit(1)
        .for('update')
      if (
        !currentDrain ||
        currentRun?.status !== 'running' ||
        currentDrain.cursor !== checkpointCursor
      ) {
        throw new Error('Data drain run lease lost')
      }
      await tx
        .update(dataDrains)
        .set({
          cursor,
          ...(status === 'success' ? { lastSuccessAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(dataDrains.id, drainId))
      await tx
        .update(dataDrainRuns)
        .set({
          status,
          ...(status === 'success' ? { finishedAt: now } : {}),
          rowsExported,
          bytesWritten,
          cursorAfter: cursor,
          locators,
          error: null,
        })
        .where(eq(dataDrainRuns.id, runId))
    })
    checkpointCursor = cursor
  }

  try {
    const config = destination.configSchema.parse(drain.destinationConfig)
    const savedCredentials = await decryptCredentials(drain.destinationCredentials)
    redactError = createCredentialErrorRedactor(savedCredentials)
    const credentials = destination.credentialsSchema.parse(savedCredentials)
    const activeSession = destination.openSession({ config, credentials })
    session = activeSession

    let lines: string[] = []
    let rowCursors: Cursor[] = []
    let lineSizes: number[] = []
    let chunkBytes = 0
    const softDeadline = startedAt.getTime() + DATA_DRAIN_LIMITS.softDurationMs

    async function deliverChunk(): Promise<void> {
      if (lines.length === 0) return
      signal.throwIfAborted()
      const rowCount = lines.length
      const body = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
      let acknowledgedRows = 0
      const acknowledge = async (result: { locator: string; rowCount: number }) => {
        if (
          !Number.isInteger(result.rowCount) ||
          result.rowCount <= 0 ||
          acknowledgedRows + result.rowCount > rowCount
        ) {
          throw new Error('Invalid data drain delivery acknowledgement')
        }
        const nextRows = acknowledgedRows + result.rowCount
        locators.push(result.locator)
        rowsExported += result.rowCount
        for (let index = acknowledgedRows; index < nextRows; index++) {
          bytesWritten += lineSizes[index]
        }
        cursor = rowCursors[nextRows - 1]
        await checkpoint('running')
        acknowledgedRows = nextRows
      }
      const result = await runWithOutboundOrganization(drain.organizationId, () =>
        activeSession.deliver({
          body,
          contentType: 'application/x-ndjson',
          metadata: {
            drainId,
            runId,
            source: drain.source,
            sequence,
            rowCount,
            runStartedAt: startedAt,
          },
          signal,
          acknowledge,
        })
      )
      if (acknowledgedRows === 0) await acknowledge({ locator: result.locator, rowCount })
      if (acknowledgedRows !== rowCount) {
        throw new Error('Incomplete data drain delivery acknowledgement')
      }
      sequence++
      lines = []
      rowCursors = []
      lineSizes = []
      chunkBytes = 0
    }

    function runWindowFull(): boolean {
      return (
        sequence >= DATA_DRAIN_LIMITS.maxChunksPerRun ||
        rowsExported >= DATA_DRAIN_LIMITS.maxRowsPerRun ||
        bytesWritten >= DATA_DRAIN_LIMITS.maxBytesPerRun ||
        Date.now() >= softDeadline
      )
    }

    pages: for await (const chunk of source.pages({
      organizationId: drain.organizationId,
      cursor,
      chunkSize: DATA_DRAIN_LIMITS.pageRows,
      signal,
    })) {
      for (const row of chunk) {
        if (runWindowFull() || rowsExported + lines.length >= DATA_DRAIN_LIMITS.maxRowsPerRun) {
          await deliverChunk()
          hasMore = true
          break pages
        }
        const line = JSON.stringify(source.serialize(row))
        const rowBytes = Buffer.byteLength(line, 'utf8')
        if (rowBytes > DATA_DRAIN_LIMITS.maxRowBytes) {
          throw new Error(
            `Data drain record is ${rowBytes} bytes, exceeds the ${DATA_DRAIN_LIMITS.maxRowBytes}-byte limit`
          )
        }
        const lineBytes = rowBytes + 1
        if (chunkBytes + lineBytes > DATA_DRAIN_LIMITS.maxChunkBytes) {
          await deliverChunk()
          if (runWindowFull()) {
            hasMore = true
            break pages
          }
        }
        if (bytesWritten + chunkBytes + lineBytes > DATA_DRAIN_LIMITS.maxBytesPerRun) {
          await deliverChunk()
          hasMore = true
          break pages
        }
        lines.push(line)
        rowCursors.push(source.cursorAfter(row))
        lineSizes.push(lineBytes)
        chunkBytes += lineBytes
      }
      await deliverChunk()
      if (runWindowFull()) {
        hasMore = true
        break
      }
    }

    if (signal.aborted) {
      throw new Error('Data drain run cancelled')
    }

    await checkpoint('success')

    logger.info('Data drain run succeeded', {
      drainId,
      runId,
      source: drain.source,
      destinationType: drain.destinationType,
      rowsExported,
      bytesWritten,
      chunks: sequence,
      hasMore,
    })

    return {
      drainId,
      runId,
      status: 'success',
      rowsExported,
      bytesWritten,
      cursorBefore,
      cursorAfter: cursor,
      locators,
      hasMore,
    }
  } catch (error) {
    const finishedAt = new Date()
    const message = redactError(error)
    try {
      await db.transaction(async (tx) => {
        await tx
          .select({ id: dataDrains.id })
          .from(dataDrains)
          .where(eq(dataDrains.id, drainId))
          .limit(1)
          .for('update')
        const [currentRun] = await tx
          .select({ status: dataDrainRuns.status, cursorAfter: dataDrainRuns.cursorAfter })
          .from(dataDrainRuns)
          .where(eq(dataDrainRuns.id, runId))
          .limit(1)
          .for('update')
        if (currentRun?.status !== 'running') return
        await tx.update(dataDrains).set({ updatedAt: finishedAt }).where(eq(dataDrains.id, drainId))
        await tx
          .update(dataDrainRuns)
          .set({
            status: 'failed',
            finishedAt,
            rowsExported,
            bytesWritten,
            cursorAfter: currentRun.cursorAfter,
            locators,
            error: message,
          })
          .where(eq(dataDrainRuns.id, runId))
      })
    } catch (statusError) {
      // Best-effort status write — the reaper repairs stuck rows. Log so DB
      // outages don't hide behind the original delivery error.
      logger.error('Failed to record data drain failure status', {
        drainId,
        runId,
        deliveryError: message,
        statusError: redactError(statusError),
      })
    }

    logger.error('Data drain run failed', {
      drainId,
      runId,
      source: drain.source,
      destinationType: drain.destinationType,
      error: message,
    })

    throw new Error(message)
  } finally {
    if (session) {
      try {
        await session.close()
      } catch (closeError) {
        logger.warn('Data drain session close failed', {
          drainId,
          runId,
          error: redactError(closeError),
        })
      }
    }
  }
}
