import { db } from '@sim/db'
import { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { decryptCredentials } from '@/lib/data-drains/encryption'
import { getSource } from '@/lib/data-drains/sources/registry'
import type { Cursor, RunTrigger } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainsService')

const CHUNK_SIZE = 1000

export interface RunDrainResult {
  drainId: string
  runId: string
  status: 'success' | 'failed' | 'skipped'
  rowsExported: number
  bytesWritten: number
  cursorBefore: Cursor
  cursorAfter: Cursor
  locators: string[]
  error?: string
}

/**
 * Orchestrates one drain export. Source-/destination-agnostic — talks only to
 * the registry interfaces. The drain's cursor is advanced only when the entire
 * run completes successfully so consumers see at-least-once delivery and can
 * dedupe on the per-row `id` field.
 */
export async function runDrain(
  drainId: string,
  trigger: RunTrigger,
  options: { signal?: AbortSignal } = {}
): Promise<RunDrainResult> {
  const signal = options.signal ?? new AbortController().signal
  const [drain] = await db.select().from(dataDrains).where(eq(dataDrains.id, drainId)).limit(1)
  if (!drain) {
    throw new Error(`Data drain not found: ${drainId}`)
  }
  if (!drain.enabled) {
    return {
      drainId,
      runId: '',
      status: 'skipped',
      rowsExported: 0,
      bytesWritten: 0,
      cursorBefore: drain.cursor,
      cursorAfter: drain.cursor,
      locators: [],
    }
  }

  const source = getSource(drain.source)
  const destination = getDestination(drain.destinationType)

  const runId = generateId()
  const startedAt = new Date()
  await db.insert(dataDrainRuns).values({
    id: runId,
    drainId,
    status: 'running',
    trigger,
    startedAt,
    cursorBefore: drain.cursor,
  })

  const cursorBefore = drain.cursor
  let cursor: Cursor = drain.cursor
  let rowsExported = 0
  let bytesWritten = 0
  let sequence = 0
  const locators: string[] = []

  /**
   * Schema-parse and decrypt happen *after* the run row is created so failures
   * in either (e.g. encryption-key rotation, schema drift across versions)
   * surface as a `failed` run row in the UI rather than vanishing into the
   * background-job logs while `lastRunAt` quietly advances.
   */
  let session: ReturnType<typeof destination.openSession> | null = null

  try {
    const config = destination.configSchema.parse(drain.destinationConfig)
    const credentials = destination.credentialsSchema.parse(
      await decryptCredentials(drain.destinationCredentials)
    )
    session = destination.openSession({ config, credentials })

    for await (const chunk of source.pages({
      organizationId: drain.organizationId,
      cursor,
      chunkSize: CHUNK_SIZE,
      signal,
    })) {
      const ndjson = `${chunk.map((row) => JSON.stringify(source.serialize(row))).join('\n')}\n`
      const body = Buffer.from(ndjson, 'utf8')

      const result = await session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: {
          drainId,
          runId,
          source: drain.source,
          sequence,
          rowCount: chunk.length,
          runStartedAt: startedAt,
        },
        signal,
      })

      locators.push(result.locator)
      rowsExported += chunk.length
      bytesWritten += body.byteLength
      cursor = source.cursorAfter(chunk[chunk.length - 1])
      sequence++
    }

    if (signal.aborted) {
      throw new Error('Data drain run cancelled')
    }

    const finishedAt = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(dataDrains)
        .set({
          cursor,
          lastRunAt: finishedAt,
          lastSuccessAt: finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(dataDrains.id, drainId))
      await tx
        .update(dataDrainRuns)
        .set({
          status: 'success',
          finishedAt,
          rowsExported,
          bytesWritten,
          cursorAfter: cursor,
          locators,
          error: null,
        })
        .where(eq(dataDrainRuns.id, runId))
    })

    logger.info('Data drain run succeeded', {
      drainId,
      runId,
      source: drain.source,
      destinationType: drain.destinationType,
      rowsExported,
      bytesWritten,
      chunks: sequence,
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
    }
  } catch (error) {
    const finishedAt = new Date()
    const message = toError(error).message
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(dataDrains)
          .set({ lastRunAt: finishedAt, updatedAt: finishedAt })
          .where(eq(dataDrains.id, drainId))
        await tx
          .update(dataDrainRuns)
          .set({
            status: 'failed',
            finishedAt,
            rowsExported,
            bytesWritten,
            cursorAfter: cursorBefore,
            locators,
            error: message.slice(0, 4000),
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
        statusError: toError(statusError).message,
      })
    }

    logger.error('Data drain run failed', {
      drainId,
      runId,
      source: drain.source,
      destinationType: drain.destinationType,
      error: message,
    })

    throw error
  } finally {
    if (session) {
      try {
        await session.close()
      } catch (closeError) {
        logger.warn('Data drain session close failed', {
          drainId,
          runId,
          error: toError(closeError).message,
        })
      }
    }
  }
}
