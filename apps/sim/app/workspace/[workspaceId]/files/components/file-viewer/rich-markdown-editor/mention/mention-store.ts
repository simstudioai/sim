import type { MentionItem } from './types'

/**
 * A tiny external store bridging React Query data (host component) into the `@` menu list, which is
 * rendered by TipTap's `ReactRenderer` as a detached root with no access to the app's React context
 * providers. The host pushes the latest items (and whether the file search is settling) via {@link MentionStore.set}; the list subscribes with
 * `useSyncExternalStore` and re-renders when async data lands — so the menu populates live even if it
 * was opened before the data finished loading. One store instance lives per editor (in extension
 * storage).
 */
export interface MentionStore {
  getSnapshot: () => MentionMenuData
  subscribe: (listener: () => void) => () => void
  set: (data: MentionMenuData) => void
}

/** The menu's items, and whether the file search behind them is still settling. */
export interface MentionMenuData {
  items: MentionItem[]
  filesPending: boolean
}

const EMPTY_MENU: MentionMenuData = { items: [], filesPending: false }

export function createMentionStore(): MentionStore {
  let data = EMPTY_MENU
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => data,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next) => {
      if (next === data) return
      data = next
      for (const listener of listeners) listener()
    },
  }
}
