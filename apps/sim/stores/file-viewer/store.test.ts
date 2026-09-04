/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileViewerStore } from '@/stores/file-viewer/store'

describe('file viewer session state', () => {
  beforeEach(() => useFileViewerStore.getState().reset())

  it('notifies subscribers only for newly recognized pages', () => {
    const listener = vi.fn()
    const unsubscribe = useFileViewerStore.subscribe(listener)
    const { rememberPage } = useFileViewerStore.getState()
    const previous = useFileViewerStore.getState().pageFileIds
    rememberPage('page-a')
    rememberPage('page-a')
    expect(listener).toHaveBeenCalledOnce()
    expect(previous.size).toBe(0)
    expect(useFileViewerStore.getState().pageFileIds.has('page-a')).toBe(true)
    expect(useFileViewerStore.getState().pageFileIds.has('page-b')).toBe(false)
    unsubscribe()
  })

  it('clears recognition when the session is reset', () => {
    useFileViewerStore.getState().rememberPage('page-a')
    useFileViewerStore.getState().reset()
    expect(useFileViewerStore.getState().pageFileIds.size).toBe(0)
  })
})
