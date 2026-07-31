import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImportFailure } from '@/main/browser-import/types'

/**
 * Reads a Chrome SQLite database without touching the original.
 *
 * Chrome keeps its databases open and may hold a write-ahead log, so every
 * read works from a private copy: the source is only ever read, never opened
 * for writing and never locked, and the copy lives in a fresh temporary
 * directory removed on success, failure, and cancellation alike. Both the
 * cookie and password readers go through here so that guarantee is written
 * once rather than reimplemented per database.
 */

/** SQLite keeps recent writes beside the main file; both are needed for a faithful copy. */
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm']

async function queryCopy(databasePath: string, query: string): Promise<Record<string, unknown>[]> {
  // Imported lazily: `node:sqlite` is only needed on the import path, and this
  // keeps module load working on runtimes that lack it.
  const { DatabaseSync } = await import('node:sqlite')

  let database: InstanceType<typeof DatabaseSync>
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
  } catch {
    // A write-ahead log that needs recovery cannot be opened read-only.
    // Reopening the *copy* writable is safe — Chrome's own file is not this one.
    try {
      database = new DatabaseSync(databasePath)
    } catch {
      throw new ImportFailure('profile-unreadable', 'Could not open the copied database.')
    }
  }

  try {
    const statement = database.prepare(query)
    // Chrome's microsecond timestamps overflow a JS number's safe integer
    // range, which this API rejects unless BigInt reads are enabled.
    statement.setReadBigInts(true)
    return statement.all() as Record<string, unknown>[]
  } catch {
    throw new ImportFailure('unsupported-schema', 'The Chrome table is not in a recognised shape.')
  } finally {
    database.close()
  }
}

/**
 * Copies `sourcePath` (plus any SQLite sidecars) to private temporary storage
 * and runs `query` against the copy. The copy is always deleted.
 */
export async function queryBrowserDatabase(
  sourcePath: string,
  fileName: string,
  query: string
): Promise<Record<string, unknown>[]> {
  const staging = await mkdtemp(join(tmpdir(), 'sim-chrome-import-'))
  try {
    const workingCopy = join(staging, fileName)
    try {
      await copyFile(sourcePath, workingCopy)
    } catch {
      throw new ImportFailure('profile-unreadable', 'Could not read the Chrome database.')
    }
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      // Absent sidecars are normal: they only exist while a WAL is live.
      await copyFile(`${sourcePath}${suffix}`, `${workingCopy}${suffix}`).catch(() => {})
    }
    return await queryCopy(workingCopy, query)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
