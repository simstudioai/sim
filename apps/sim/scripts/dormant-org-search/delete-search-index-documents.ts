#!/usr/bin/env bun

/**
 * Deletes every connector-owned document and chunk of one organization search index, keeping the
 * knowledge base row and its (paused) connectors, then clears the connectors' listing cursors so a
 * resumed connector lists its source from scratch.
 *
 * Usage:
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/delete-search-index-documents.ts \
 *     --knowledge-base-id=<knowledge-base-id>                        # dry run: guard + first pages
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/delete-search-index-documents.ts \
 *     --knowledge-base-id=<knowledge-base-id> --execute [--max-pages=50] [--after-id=<document-id>]
 *
 * Options:
 *   --page-size=200                 documents per page
 *   --chunk-batch-size=1000         chunks per delete transaction
 *   --pause-ms=250                  pause after every committed transaction
 *   --max-pages=N                   stop after N pages (dry run default 3; unbounded when executing)
 *   --after-id=<document-id>        resume after this document id
 *   --storage-cleanup-ceiling=2000  pending storage cleanup events before the run waits
 *   --lock-timeout-ms=5000          per transaction
 *   --statement-timeout-ms=60000    per statement
 *   --no-connector-reset            keep the connectors' listing cursors
 *
 * Exit codes: 0 finished or stopped at --max-pages (resume with the logged --after-id), 1 failed,
 * 2 refused by a precondition (checked before every page; nothing after the refusal is written).
 */

import { parseArgs } from 'node:util'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  resolveExecuteFlag,
} from '@/scripts/dormant-org-search/cli'
import {
  DEFAULT_CHUNK_BATCH_SIZE,
  DEFAULT_DOCUMENT_PAGE_SIZE,
  DEFAULT_PAUSE_MS,
  DEFAULT_STORAGE_CLEANUP_CEILING,
  deleteSearchIndexDocuments,
  type SearchIndexDeletionOptions,
  SearchIndexDeletionRefused,
} from '@/scripts/dormant-org-search/search-index-deletion'

const logger = createLogger('DeleteSearchIndexDocuments')

/** Refused by a precondition, before the run or before one of its pages. */
export const EXIT_REFUSED = 2

export interface DeleteSearchIndexDocumentsArgs
  extends Omit<SearchIndexDeletionOptions, 'requestId' | 'sleep'> {
  lockTimeoutMs: number
  statementTimeoutMs: number
}

/** Parses the command line; every mutation requires `--execute`. */
export function parseDeleteSearchIndexDocumentsArgs(
  argv: readonly string[]
): DeleteSearchIndexDocumentsArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'knowledge-base-id': { type: 'string' },
      execute: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'page-size': { type: 'string' },
      'chunk-batch-size': { type: 'string' },
      'pause-ms': { type: 'string' },
      'max-pages': { type: 'string' },
      'after-id': { type: 'string' },
      'storage-cleanup-ceiling': { type: 'string' },
      'lock-timeout-ms': { type: 'string' },
      'statement-timeout-ms': { type: 'string' },
      'no-connector-reset': { type: 'boolean' },
    },
    strict: true,
  })
  const knowledgeBaseId = values['knowledge-base-id']?.trim()
  if (!knowledgeBaseId) throw new Error('--knowledge-base-id is required')
  return {
    knowledgeBaseId,
    execute: resolveExecuteFlag(values),
    pageSize: parsePositiveInteger('page-size', values['page-size'], DEFAULT_DOCUMENT_PAGE_SIZE),
    chunkBatchSize: parsePositiveInteger(
      'chunk-batch-size',
      values['chunk-batch-size'],
      DEFAULT_CHUNK_BATCH_SIZE
    ),
    pauseMs: parseNonNegativeInteger('pause-ms', values['pause-ms'], DEFAULT_PAUSE_MS),
    maxPages:
      values['max-pages'] === undefined
        ? undefined
        : parsePositiveInteger('max-pages', values['max-pages'], 1),
    afterId: values['after-id'] ?? '',
    storageCleanupCeiling: parsePositiveInteger(
      'storage-cleanup-ceiling',
      values['storage-cleanup-ceiling'],
      DEFAULT_STORAGE_CLEANUP_CEILING
    ),
    resetConnectors: values['no-connector-reset'] !== true,
    lockTimeoutMs: parsePositiveInteger('lock-timeout-ms', values['lock-timeout-ms'], 5_000),
    statementTimeoutMs: parsePositiveInteger(
      'statement-timeout-ms',
      values['statement-timeout-ms'],
      60_000
    ),
  }
}

async function main(): Promise<number> {
  const args = parseDeleteSearchIndexDocumentsArgs(process.argv.slice(2))
  /** Imported after parsing, so an argument error is reported before the app's database client requires DATABASE_URL. */
  const { drizzleSearchIndexDeletionStore } = await import(
    '@/scripts/dormant-org-search/search-index-deletion-store'
  )
  const { lockTimeoutMs, statementTimeoutMs, ...options } = args
  try {
    await deleteSearchIndexDocuments(
      drizzleSearchIndexDeletionStore({ lockTimeoutMs, statementTimeoutMs }),
      { ...options, requestId: `dormant-org-search:${generateShortId()}` }
    )
    return 0
  } catch (error) {
    if (error instanceof SearchIndexDeletionRefused) {
      logger.error('Refused by a precondition; no further page was written', {
        reasons: error.reasons,
      })
      return EXIT_REFUSED
    }
    throw error
  }
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      logger.error('Search index deletion failed', toError(error))
      process.exit(1)
    }
  )
}
