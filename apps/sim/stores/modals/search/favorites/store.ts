import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface SearchFavoritesState {
  favorites: string[]
  toggleFavorite: (key: string) => void
  reset: () => void
}

const initialState = { favorites: [] as string[] }

export const useSearchFavoritesStore = create<SearchFavoritesState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        toggleFavorite: (key) =>
          set((state) => ({
            favorites: state.favorites.includes(key)
              ? state.favorites.filter((favorite) => favorite !== key)
              : [...state.favorites, key],
          })),
        reset: () => set((state) => (state.favorites.length === 0 ? state : initialState)),
      }),
      {
        name: 'search-favorites',
        partialize: (state) => ({ favorites: state.favorites }),
      }
    ),
    { name: 'search-favorites-store' }
  )
)
