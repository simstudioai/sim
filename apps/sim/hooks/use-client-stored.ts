import { useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => {}

/**
 * A value only the browser holds (a cookie, `localStorage`, a persisted store read outside its
 * hook), read where it cannot break hydration: `serverValue` in server HTML and while the calling
 * component hydrates, then `read()` on every later render. A client navigation, which hydrates
 * nothing, reads it on its first render.
 *
 * `read` runs on each render, so it must return the same value until the storage changes: a
 * primitive, or a cached reference (parse a raw string with `useMemo` after this hook). Pass
 * `subscribe` when something outside the calling component writes the value and it must repaint.
 *
 * A persisted Zustand store read through its own hook needs none of this: its hook already serves
 * the state from before rehydration as the server snapshot.
 */
export function useClientStored<T>(
  read: () => T,
  serverValue: T,
  subscribe: (onChange: () => void) => () => void = subscribeToNothing
): T {
  return useSyncExternalStore(subscribe, read, () => serverValue)
}
