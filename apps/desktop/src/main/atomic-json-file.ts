import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Owner-only, matching every store that keeps user data in userData. */
const FILE_MODE = 0o600

/**
 * Distinct per call, not just per process.
 *
 * The pid keeps a second Sim process from sharing the path — the site
 * directory used a bare `.tmp` and could be clobbered by exactly that. The
 * counter covers the other half: these stores are read-modify-write with no
 * lock, so two overlapping writes to the SAME store in one process (a password
 * import racing a forget) would otherwise both truncate and write the one
 * temp file, and the first rename would publish a spliced blob. The vault
 * treats an unparseable file as empty, so that surfaces as every saved
 * password silently vanishing.
 */
let temporaryFileCounter = 0
function temporaryPathFor(filePath: string): string {
  temporaryFileCounter += 1
  return `${filePath}.${process.pid}.${temporaryFileCounter}.tmp`
}

/**
 * Crash-safe JSON writes for the small encrypted stores in userData.
 *
 * Every one of them (local-filesystem grants, the credential vault, the site
 * directory) had written this same temp-file-then-rename sequence by hand, and
 * they had already drifted: two scoped the temporary file by pid and the third
 * did not, so two Sim processes writing that store could clobber each other
 * through a shared `.tmp` path. Owning the sequence once removes the class.
 */
export async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = temporaryPathFor(filePath)
  await writeFile(temporaryPath, JSON.stringify(value), { mode: FILE_MODE })
  await rename(temporaryPath, filePath)
}

/**
 * The same sequence for a caller that cannot await.
 *
 * Only the settings store needs this: it flushes on `before-quit`, where the
 * event loop stops before a promise would settle. `indent` because that file
 * is one users open and edit by hand.
 */
export function writeJsonFileAtomicallySync(
  filePath: string,
  value: unknown,
  indent?: number
): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = temporaryPathFor(filePath)
  writeFileSync(temporaryPath, JSON.stringify(value, null, indent), { mode: FILE_MODE })
  renameSync(temporaryPath, filePath)
}

/**
 * Deletes a store file, treating "already gone" as success.
 *
 * Anything else rethrows: a store that reports a successful `clear()` after an
 * EACCES tells sign-out teardown the data is gone when it is still on disk.
 */
export async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
