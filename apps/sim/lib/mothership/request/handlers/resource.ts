import type { StreamHandler } from './types'

/**
 * Deliberate no-op: resource frames exist for the CLIENT renderer (workspace chips);
 * the server-side loop has nothing to do with them. Registered explicitly so an
 * unhandled-event warning never fires for a frame type we know and ignore.
 */
export const handleResourceEvent: StreamHandler = (event) => {
  if (event.type !== 'resource') {
    return
  }
}
