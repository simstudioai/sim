import { embedStore } from '#sim-cli/embed-context'
import { flushOutput, printError } from '#sim-cli/output/io'

const INTERRUPT_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

/** How long an interrupt waits for a deferred write before the command stops without it. */
export const DEFERRED_INTERRUPT_BOUND_MS = 60_000

interface Deferral {
  pending: NodeJS.Signals | null
}

let active: Deferral | null = null

/**
 * Whether an interrupt arriving now is held by {@link deferInterrupts}. A signal handler that
 * cleans up and ends the process returns without acting while this holds: the deferral raises
 * the signal again once its write is done (or abandoned), and the handler runs then.
 */
export function interruptsDeferred(): boolean {
  return active !== null
}

export interface DeferInterruptsOptions {
  /** Printed at the first interrupt: what the command finishes before it stops. */
  waiting: string
  /** Printed when the command stops without finishing: a second interrupt, or the bound elapsed. */
  abandoned: string
  boundMs?: number
}

/**
 * Runs `run`, a write the server may already be committing followed by saving its answer
 * locally, with Ctrl-C (and `SIGTERM`) held until it ends: stopping in between leaves a write the
 * server made that the directory never recorded. The first interrupt prints `waiting`; when
 * `run` settles the process ends by that signal (exit 130 for Ctrl-C). A second interrupt, or
 * `boundMs` passing, stops at once and prints `abandoned`, which names how to recover.
 */
export async function deferInterrupts<T>(
  run: () => Promise<T>,
  options: DeferInterruptsOptions
): Promise<T> {
  if (embedStore.getStore() || active) return run()
  const deferral: Deferral = { pending: null }
  let bound: ReturnType<typeof setTimeout> | undefined

  const release = () => {
    for (const signal of INTERRUPT_SIGNALS) process.off(signal, onSignal)
    clearTimeout(bound)
    if (active === deferral) active = null
  }
  /**
   * Ends the process by `signal` once stdout and stderr have drained, as every other exit does,
   * so a backed-up pipe still receives what was printed. The handler is already released: an
   * interrupt while they drain ends the process at once.
   */
  const reraise = (signal: NodeJS.Signals) => {
    void flushOutput().finally(() => process.kill(process.pid, signal))
  }
  const abandon = (signal: NodeJS.Signals) => {
    release()
    printError(options.abandoned)
    reraise(signal)
  }
  function onSignal(signal: NodeJS.Signals) {
    if (deferral.pending) {
      abandon(signal)
      return
    }
    deferral.pending = signal
    printError(options.waiting)
    bound = setTimeout(() => abandon(signal), options.boundMs ?? DEFERRED_INTERRUPT_BOUND_MS)
  }

  active = deferral
  for (const signal of INTERRUPT_SIGNALS) process.on(signal, onSignal)
  try {
    return await run()
  } finally {
    const held = active === deferral ? deferral.pending : null
    release()
    if (held) reraise(held)
  }
}
