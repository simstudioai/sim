import type { MentionItem } from './types'

/**
 * A tiny external store bridging React Query data (host component) into the `@` menu list, which is
 * rendered by TipTap's `ReactRenderer` as a detached root with no access to the app's React context
 * providers. The host pushes the latest items via {@link MentionStore.set}; the list subscribes with
 * `useSyncExternalStore` and re-renders when async data lands — so the menu populates live even if it
 * was opened before the data finished loading. One store instance lives per editor (in extension
 * storage).
 */
export interface MentionStore {
  getSnapshot: () => MentionItem[]
  subscribe: (listener: () => void) => () => void
  set: (items: MentionItem[]) => void
}

export function createMentionStore(): MentionStore {
  let items: MentionItem[] = []
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => items,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next) => {
      if (next === items) return
      items = next
      for (const listener of listeners) listener()
    },
  }
}
