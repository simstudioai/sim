/** The desktop tools of one turn that are still running in this tab, and the Stop that ends them. */
interface RunningTurnTools {
  stop: AbortController
  running: number
}

/**
 * Turns with a desktop tool still running in this tab, keyed by the turn's stream id. A tool
 * outlives the chat view that started it (and any stream reader), so the turn, not the view, owns
 * its Stop. A turn is held only while one of its tools runs: each tool releases it as it settles.
 * Terminal commands take no lease: Stop ends them through the turn's resource activity, which
 * clears the agent's commands in each scope it touched.
 */
const runningTurns = new Map<string, RunningTurnTools>()

/** A running desktop tool's hold on its turn. */
interface DesktopToolLease {
  /** Aborted only by the user's Stop of the turn. */
  signal: AbortSignal
  /** Called once when the tool settles. */
  release(): void
}

/**
 * Starts a desktop tool (a browser action, a local file read or import) for a turn. Only the
 * user's Stop of that turn cancels it: replacing the stream reader, leaving the chat view, or
 * stopping another chat's turn leaves it running to finish and report its own result.
 */
export function leaseDesktopTool(streamId: string): DesktopToolLease {
  let turn = runningTurns.get(streamId)
  if (!turn) {
    turn = { stop: new AbortController(), running: 0 }
    runningTurns.set(streamId, turn)
  }
  turn.running += 1
  const held = turn
  let released = false
  return {
    signal: held.stop.signal,
    release() {
      if (released) return
      released = true
      held.running -= 1
      if (held.running === 0 && runningTurns.get(streamId) === held) runningTurns.delete(streamId)
    },
  }
}

/** Cancels the running desktop tools of a turn the user stopped, from whichever view started them. */
export function stopDesktopTools(streamId: string, reason: string): void {
  runningTurns.get(streamId)?.stop.abort(reason)
  runningTurns.delete(streamId)
}

/** Cancels every running desktop tool in this tab, so none outlives the session that started it. */
export function stopAllDesktopTools(reason: string): void {
  for (const turn of runningTurns.values()) turn.stop.abort(reason)
  runningTurns.clear()
}
