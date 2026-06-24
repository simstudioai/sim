import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** One recorded selection, keyed by `<kind>:<id>` (e.g. `tool:slack`). */
interface RecentEntry {
  /** How many times this item has been selected. */
  count: number
  /** Epoch ms of the most recent selection. */
  lastUsedAt: number
}

interface SearchRecentsState {
  entries: Record<string, RecentEntry>
  /** Record a selection, bumping its frequency and recency. */
  record: (key: string) => void
  /** Forget all recents. */
  clear: () => void
}

/** Cap stored entries so localStorage stays bounded; least-recent are pruned. */
const MAX_ENTRIES = 50

/** Recency half-life: an item's frecency weight halves every 7 days. */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Frecency score combining frequency and recency: frequent items rank high,
 * but their weight decays as they go unused so stale picks fall away. Higher
 * sorts first.
 */
export function frecencyScore(entry: RecentEntry, now: number): number {
  return entry.count * 2 ** (-(now - entry.lastUsedAt) / HALF_LIFE_MS)
}

export const useSearchRecentsStore = create<SearchRecentsState>()(
  persist(
    (set) => ({
      entries: {},

      record: (key) =>
        set((state) => {
          const previous = state.entries[key]
          const entries: Record<string, RecentEntry> = {
            ...state.entries,
            [key]: { count: (previous?.count ?? 0) + 1, lastUsedAt: Date.now() },
          }

          const keys = Object.keys(entries)
          if (keys.length <= MAX_ENTRIES) return { entries }

          const kept = keys
            .sort((a, b) => entries[b].lastUsedAt - entries[a].lastUsedAt)
            .slice(0, MAX_ENTRIES)
          const pruned: Record<string, RecentEntry> = {}
          for (const k of kept) pruned[k] = entries[k]
          return { entries: pruned }
        }),

      clear: () => set({ entries: {} }),
    }),
    {
      name: 'search-recents',
      partialize: (state) => ({ entries: state.entries }),
    }
  )
)
