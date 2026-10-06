import { LRUCache } from 'lru-cache'

/**
 * Turns whose desktop tools may still be running in this tab. A tool outlives the chat view that
 * started it (and any stream reader), so the turn, not the view, owns its Stop. Bounded: a tool
 * runs for minutes, far fewer turns than this.
 */
const turnStops = new LRUCache<string, AbortController>({ max: 64 })

/**
 * The lifetime of a desktop tool (a browser action, a local file read or import) started for a
 * turn: only the user's Stop of that turn ends it. Replacing the stream reader, leaving the chat
 * view, or stopping another chat's turn leaves it running to finish and report its own result.
 */
export function desktopToolLifetime(streamId: string): AbortSignal {
  let stop = turnStops.get(streamId)
  if (!stop) {
    stop = new AbortController()
    turnStops.set(streamId, stop)
  }
  return stop.signal
}

/** Cancels the desktop tools of a turn the user stopped, from whichever view started them. */
export function stopDesktopTools(streamId: string, reason: string): void {
  turnStops.get(streamId)?.abort(reason)
  turnStops.delete(streamId)
}
