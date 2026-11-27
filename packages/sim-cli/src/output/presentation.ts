import chalk, { Chalk } from 'chalk'
import { embedStore } from '#sim-cli/embed-context'

const plain = new Chalk({ level: 0 })

/**
 * Whether the environment asks for no colour: a non-empty `NO_COLOR` (https://no-color.org) or a
 * `dumb` terminal. chalk reads neither `NO_COLOR` nor, once its level is fixed at import, a
 * `TERM` set later. An explicit `FORCE_COLOR` wins, as it does in Node's own colouring.
 */
function dumbOrNoColor(): boolean {
  const { NO_COLOR, FORCE_COLOR, TERM } = process.env
  if (FORCE_COLOR !== undefined) return false
  return (NO_COLOR !== undefined && NO_COLOR !== '') || TERM === 'dumb'
}

/** Embedded output is data; choose plain CLI styling without changing the host's Chalk. */
export function styles() {
  return embedStore.getStore() || dumbOrNoColor() ? plain : chalk
}

/** A hosting server's terminal is never the embedded invocation's progress display. */
export function hasProgressTerminal(): boolean {
  return !embedStore.getStore() && process.env.TERM !== 'dumb' && Boolean(process.stderr.isTTY)
}
