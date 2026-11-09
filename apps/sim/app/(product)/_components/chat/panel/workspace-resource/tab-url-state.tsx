'use client'

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from 'react'
import {
  type unstable_AdapterInterface as AdapterInterface,
  unstable_createAdapterProvider as createAdapterProvider,
} from 'nuqs/adapters/custom'

/** One tab's query string, held in memory instead of the address bar. */
function createSearchStore() {
  let search = new URLSearchParams()
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    current: () => search,
    /** A copy, because a queued update edits the snapshot it is handed. */
    snapshot: () => new URLSearchParams(search),
    update(next: URLSearchParams) {
      search = new URLSearchParams(next)
      for (const listener of listeners) listener()
    },
  }
}

const SearchStore = createContext<ReturnType<typeof createSearchStore> | null>(null)

function useTabAdapter(): AdapterInterface {
  const store = useContext(SearchStore)
  if (!store) throw new Error('A panel tab reads its URL state inside TabUrlState')
  const searchParams = useSyncExternalStore(store.subscribe, store.current, store.current)
  return { searchParams, updateUrl: store.update, getSearchParamsSnapshot: store.snapshot }
}

const TabAdapter = createAdapterProvider(useTabAdapter)

/**
 * Gives a workspace page shown in a chat panel tab its own URL state. Its filters, sort, search and
 * pagination live with the tab, so they never write over the chat's address or another tab's.
 */
export function TabUrlState({ children }: { children: ReactNode }) {
  const [store] = useState(createSearchStore)
  return (
    <SearchStore.Provider value={store}>
      <TabAdapter>{children}</TabAdapter>
    </SearchStore.Provider>
  )
}
