#!/usr/bin/env bun

/**
 * Backfill `copilot_messages.display_content` for messages written before it existed, so the
 * chat UI's transcript reads stop detoasting their full tool-call params.
 *
 * Walks the table in primary-key order, reading assistant messages in paced batches and storing
 * a projection for each one whose tool-call params the UI truncates. A row is updated only while
 * it is unchanged since it was read, so a message rewritten concurrently keeps the projection
 * its writer stored. `--min-bytes` skips messages whose stored (compressed) `content` is smaller,
 * read from the TOAST pointer without loading the value; it defaults to 0 because repetitive
 * params compress far below the size the UI pays to receive them.
 * Idempotent and resumable: re-running skips rows that already have one, and `--after=<id>`
 * resumes from the last id logged.
 *
 * Usage:
 *   cd apps/sim && DATABASE_URL=... bun scripts/copilot-messages-backfill-display-content.ts \
 *     [--dry-run] [--after=<uuid>] [--min-bytes=0] [--pause-ms=200]
 */

import { parseArgs } from 'node:util'
import { db } from '@sim/db'
import { copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  displayContentOf,
  type PersistedMessage,
  stripToolResultOutput,
} from '@/lib/mothership/chat/persisted-message'

const logger = createLogger('CopilotMessagesDisplayBackfill', { enabled: true, logLevel: 'INFO' })

const SCAN_BATCH = 1000
const CONTENT_BATCH = 20

function wholeNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a whole number`)
  return value
}

/** The stored projection for a row's content, or null when it has none to store. */
function displayProjection(content: unknown): PersistedMessage | null {
  const message = content as PersistedMessage
  if (!isRecordLike(content) || typeof message.id !== 'string') return null
  return displayContentOf(stripToolResultOutput(message))
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      after: { type: 'string' },
      'min-bytes': { type: 'string' },
      'pause-ms': { type: 'string' },
    },
  })
  const dryRun = values['dry-run']
  const minBytes = wholeNumber('min-bytes', values['min-bytes'], 0)
  const pauseMs = wholeNumber('pause-ms', values['pause-ms'], 200)
  let after = values.after ?? null

  let scanned = 0
  let updated = 0
  const startedAt = Date.now()
  for (;;) {
    const ids = await db
      .select({
        id: copilotMessages.id,
        size: sql<number>`pg_column_size(${copilotMessages.content})`,
      })
      .from(copilotMessages)
      .where(
        and(
          after ? gt(copilotMessages.id, after) : undefined,
          eq(copilotMessages.role, 'assistant'),
          isNull(copilotMessages.displayContent)
        )
      )
      .orderBy(asc(copilotMessages.id))
      .limit(SCAN_BATCH)
    if (ids.length === 0) break
    scanned += ids.length
    after = ids[ids.length - 1].id

    const large = ids.filter((row) => row.size >= minBytes).map((row) => row.id)
    for (let start = 0; start < large.length; start += CONTENT_BATCH) {
      const rows = await db
        .select({
          id: copilotMessages.id,
          content: copilotMessages.content,
          updatedAt: sql<string>`${copilotMessages.updatedAt}::text`,
        })
        .from(copilotMessages)
        .where(inArray(copilotMessages.id, large.slice(start, start + CONTENT_BATCH)))
      for (const row of rows) {
        const display = displayProjection(row.content)
        if (!display) continue
        if (dryRun) {
          updated++
          continue
        }
        const written = await db
          .update(copilotMessages)
          .set({ displayContent: display })
          .where(
            and(
              eq(copilotMessages.id, row.id),
              sql`${copilotMessages.updatedAt} = ${row.updatedAt}::timestamp`,
              isNull(copilotMessages.displayContent)
            )
          )
          .returning({ id: copilotMessages.id })
        updated += written.length
      }
      await sleep(pauseMs)
    }

    logger.info('Backfill progress', {
      scanned,
      [dryRun ? 'wouldUpdate' : 'updated']: updated,
      after,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    })
    await sleep(pauseMs)
  }

  logger.info('Backfill complete', { scanned, [dryRun ? 'wouldUpdate' : 'updated']: updated })
  process.exit(0)
}

main().catch((error) => {
  logger.error('Backfill failed', { error })
  process.exit(1)
})
