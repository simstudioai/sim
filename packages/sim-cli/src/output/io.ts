import { format } from 'node:util'
import { embedStore } from '../embed-context'

/** Only CLI-owned output enters the invocation result; host logs retain their normal sinks. */
export function printLine(...args: unknown[]): void {
  const context = embedStore.getStore()
  if (context) context.stdout.write(`${format(...args)}\n`)
  else console.log(...args)
}

export function printError(...args: unknown[]): void {
  const context = embedStore.getStore()
  if (context) context.stderr.write(`${format(...args)}\n`)
  else console.error(...args)
}

export function writeStdout(chunk: string | Uint8Array): boolean {
  const context = embedStore.getStore()
  if (!context) return process.stdout.write(chunk)
  context.stdout.write(chunk)
  return true
}

export function writeStderr(chunk: string | Uint8Array): boolean {
  const context = embedStore.getStore()
  if (!context) return process.stderr.write(chunk)
  context.stderr.write(chunk)
  return true
}
