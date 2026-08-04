/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useSearchFavoritesStore } from '@/stores/modals/search/favorites/store'

describe('useSearchFavoritesStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSearchFavoritesStore.getState().reset()
  })

  it('pins and unpins section-qualified entries in selection order', () => {
    const store = useSearchFavoritesStore.getState()

    store.toggleFavorite('chats:chat-1')
    store.toggleFavorite('workflows:workflow-1')
    expect(useSearchFavoritesStore.getState().favorites).toEqual([
      'chats:chat-1',
      'workflows:workflow-1',
    ])

    useSearchFavoritesStore.getState().toggleFavorite('chats:chat-1')
    expect(useSearchFavoritesStore.getState().favorites).toEqual(['workflows:workflow-1'])
  })

  it('resets all pinned entries', () => {
    useSearchFavoritesStore.getState().toggleFavorite('pages:settings')
    useSearchFavoritesStore.getState().reset()

    expect(useSearchFavoritesStore.getState().favorites).toEqual([])
  })

  it('rehydrates pinned entries from local storage', async () => {
    useSearchFavoritesStore.setState({ favorites: [] })
    localStorage.setItem(
      'search-favorites',
      JSON.stringify({ state: { favorites: ['chats:chat-1'] }, version: 0 })
    )

    await useSearchFavoritesStore.persist.rehydrate()

    expect(useSearchFavoritesStore.getState().favorites).toEqual(['chats:chat-1'])
  })
})
