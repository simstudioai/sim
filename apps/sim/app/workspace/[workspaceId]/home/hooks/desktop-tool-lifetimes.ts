/** The desktop tools of one turn that are still running in this tab, and the Stop that ends them. */
interface RunningTurnTools {
  stop: AbortController
  running: number
}

/**
 * Turns with a desktop tool still running in this tab, keyed by the turn's stream id. A tool
 * outlives the chat view that started it (and any stream reader), so the turn, not the view, owns
 * its Stop. A turn is held only while one of its tools runs: each tool releases it as it settles.
 * Terminal calls take no lease. A terminal call returns once its operation does (a `run` after
 * its wait window), and the command it started keeps running in a terminal tab the user can see
 * and control. Stop settles the agent's marks on that tab through the turn's resource activity;
 * the process itself is the user's to end.
 */
const runningTurns = new Map<string, RunningTurnTools>()

/** Aborted by `stopAllDesktopTools`, then replaced, so each signed-in session has its own. */
let session = new AbortController()

/** A running desktop tool's hold on its turn. */
interface DesktopToolLease {
  /** Aborted only by the user's Stop of the turn, or by signing out. */
  signal: AbortSignal
  /** Called once when the tool settles. */
  release(): void
}

/** A turn's stream, bound to the session it started in. */
export interface DesktopToolTurn {
  /** Starts one desktop tool for the turn. */
  lease(): DesktopToolLease
}

/**
 * Binds a turn's stream to the current session. Take it once, when the stream starts: its tool
 * events can still arrive after a sign-out, and each of them then gets an already-aborted lease.
 */
export function desktopToolTurn(streamId: string): DesktopToolTurn {
  const startedIn = session.signal
  return {
    lease: () =>
      startedIn.aborted ? { signal: startedIn, release() {} } : leaseDesktopTool(streamId),
  }
}

/**
 * Starts a desktop tool (a browser action, a local file read or import) for a turn. Only the
 * user's Stop of that turn, or signing out (`stopAllDesktopTools`), cancels it: replacing the
 * stream reader, leaving the chat view, or stopping another chat's turn leaves it running to
 * finish and report its own result.
 */
function leaseDesktopTool(streamId: string): DesktopToolLease {
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

/**
 * Cancels every leased desktop tool running in this tab (browser actions, local file reads and
 * imports), and every one a turn of this session starts later, so none outlives the session
 * that started it.
 */
export function stopAllDesktopTools(reason: string): void {
  session.abort(reason)
  session = new AbortController()
  for (const turn of runningTurns.values()) turn.stop.abort(reason)
  runningTurns.clear()
}
