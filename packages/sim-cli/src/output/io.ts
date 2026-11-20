import { format } from 'node:util'
import { embedStore } from '../embed-context'

/**
 * Bun writes `console.log` to a piped stdout outside `process.stdout`, and once that stream
 * exists (anything reading `process.stdout.isTTY` creates it) the console's writes past the
 * pipe buffer are dropped when the process ends. The stream's own writes are kept, so under
 * Bun every line goes through it.
 */
const writeLinesThroughStream = process.versions.bun !== undefined

/**
 * A drain still owed per standard stream: set when a write is refused (`false`), settled by
 * `drain`, or by `error`/`close` when the reader went away. Bun reports `writableLength` as `0`
 * while it still holds the refused bytes, so this is the only signal it gives.
 */
const pendingDrains = new Map<NodeJS.WriteStream, Promise<void>>()

function writeStream(stream: NodeJS.WriteStream, chunk: string | Uint8Array): boolean {
  const accepted = stream.write(chunk)
  if (!accepted && !pendingDrains.has(stream)) {
    pendingDrains.set(
      stream,
      new Promise<void>((resolve) => {
        const settle = () => {
          stream.off('drain', settle)
          stream.off('error', settle)
          stream.off('close', settle)
          pendingDrains.delete(stream)
          resolve()
        }
        stream.once('drain', settle)
        stream.once('error', settle)
        stream.once('close', settle)
      })
    )
  }
  return accepted
}

/** Only CLI-owned output enters the invocation result; host logs retain their normal sinks. */
export function printLine(...args: unknown[]): void {
  const context = embedStore.getStore()
  if (context) context.stdout.write(`${format(...args)}\n`)
  else if (writeLinesThroughStream) writeStream(process.stdout, `${format(...args)}\n`)
  else console.log(...args)
}

export function printError(...args: unknown[]): void {
  const context = embedStore.getStore()
  if (context) context.stderr.write(`${format(...args)}\n`)
  else if (writeLinesThroughStream) writeStream(process.stderr, `${format(...args)}\n`)
  else console.error(...args)
}

export function writeStdout(chunk: string | Uint8Array): boolean {
  const context = embedStore.getStore()
  if (!context) return writeStream(process.stdout, chunk)
  context.stdout.write(chunk)
  return true
}

export function writeStderr(chunk: string | Uint8Array): boolean {
  const context = embedStore.getStore()
  if (!context) return writeStream(process.stderr, chunk)
  context.stderr.write(chunk)
  return true
}

/** Resolves once `stream` has handed everything written to it to the OS. */
async function drained(stream: NodeJS.WriteStream): Promise<void> {
  await pendingDrains.get(stream)
  if (stream.writableLength === 0 || stream.destroyed) return
  await new Promise<void>((resolve) => {
    stream.write('', () => resolve())
  })
}

/**
 * Waits until stdout and stderr have written out what the CLI printed. `process.exit` ends the
 * process at once, and a pipe holds only 64 KiB, so exiting without this cuts a large result
 * short for whatever reads it (`sim … | jq`) while the exit status still says success.
 */
export async function flushOutput(): Promise<void> {
  await Promise.all([drained(process.stdout), drained(process.stderr)])
}
