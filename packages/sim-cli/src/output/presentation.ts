import chalk, { Chalk } from 'chalk'
import { embedStore } from '#cli/embed-context'

const plain = new Chalk({ level: 0 })

/** Embedded output is data; choose plain CLI styling without changing the host's Chalk. */
export function styles() {
  return embedStore.getStore() ? plain : chalk
}

/** A hosting server's terminal is never the embedded invocation's progress display. */
export function hasProgressTerminal(): boolean {
  return !embedStore.getStore() && Boolean(process.stderr.isTTY)
}
