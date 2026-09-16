import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

/**
 * Small JSON state files under the config directory: the update-check cache
 * and the telemetry state. Both are best-effort — a file that cannot be read
 * or written must never fail the command that touched it — and both sit in a
 * directory an attacker who controls the account could pre-populate, so reads
 * are bounded and refuse symlinks, and writes replace atomically.
 */

/** Makes adjacent temporary files unique across writes in this process. */
let writeSequence = 0

/**
 * Reads and parses a JSON file, or returns `null` for anything at all wrong.
 *
 * Follows no symlink and reads no more than `maxBytes`: the file lives where
 * the user, or anything running as the user, can replace it, and the caller's
 * only interest is in a small document it wrote itself. Shape validation is
 * the caller's — this returns whatever JSON was there.
 */
export function readJsonFile(path: string, maxBytes: number): unknown {
  let descriptor: number | null = null
  try {
    if (!lstatSync(path).isFile()) return null
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size > maxBytes) return null

    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.byteLength - bytesRead,
        bytesRead
      )
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > maxBytes) return null

    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } catch {
    return null
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {}
    }
  }
}

/**
 * Replaces a JSON file atomically, creating its directory if needed.
 *
 * An exclusive adjacent temporary file renamed into place means a reader never
 * sees a partial document and a linked target is never modified through the
 * link. Failures are swallowed: the callers are caches and preferences whose
 * loss costs one extra request or one repeated notice.
 */
export function writeJsonFile(path: string, value: unknown, mode = 0o644): void {
  let descriptor: number | null = null
  let temporaryCreated = false
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${writeSequence++}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    descriptor = openSync(temporaryPath, 'wx', mode)
    temporaryCreated = true
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, path)
    temporaryCreated = false
  } catch {
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath)
      } catch {}
    }
  }
}
