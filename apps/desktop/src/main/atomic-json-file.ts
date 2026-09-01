import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Owner-only, matching every store that keeps user data in userData. */
const FILE_MODE = 0o600

export class FileResourceLimitError extends Error {
  constructor() {
    super('File exceeded the configured size limit')
    this.name = 'FileResourceLimitError'
  }
}

function validateReadableFile(isFile: boolean, size: number, maxBytes: number): void {
  if (!isFile || !Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    throw new FileResourceLimitError()
  }
}

/** Reads at most the size observed on the opened file handle, plus one growth-detection byte. */
export async function readFileWithinLimit(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const metadata = await handle.stat()
    validateReadableFile(metadata.isFile(), metadata.size, maxBytes)
    const buffer = Buffer.allocUnsafe(metadata.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > metadata.size) throw new FileResourceLimitError()
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

/** Synchronous counterpart for Electron shutdown and startup paths that cannot await. */
export function readFileWithinLimitSync(filePath: string, maxBytes: number): Buffer {
  const descriptor = openSync(filePath, 'r')
  try {
    const metadata = fstatSync(descriptor)
    validateReadableFile(metadata.isFile(), metadata.size, maxBytes)
    const buffer = Buffer.allocUnsafe(metadata.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > metadata.size) throw new FileResourceLimitError()
    return buffer.subarray(0, offset)
  } finally {
    closeSync(descriptor)
  }
}

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
