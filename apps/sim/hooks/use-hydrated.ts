import { useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => {}
const onClient = () => true
const onServer = () => false

/**
 * `true` once hydrated, `false` in server HTML and during hydration: the store-backed form React
 * reconciles without a mismatch, unlike an effect that flips state after mount.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, onClient, onServer)
}
