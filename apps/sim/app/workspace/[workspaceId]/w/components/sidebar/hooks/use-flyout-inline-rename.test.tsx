/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFlyoutInlineRename } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-flyout-inline-rename'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function renderRenameHook(onSave: (id: string, name: string) => Promise<void>) {
  const result = {} as { current: ReturnType<typeof useFlyoutInlineRename> }
  function Harness() {
    result.current = useFlyoutInlineRename({ itemType: 'workspace', onSave })
    return null
  }
  act(() => root.render(<Harness />))
  return { result }
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useFlyoutInlineRename', () => {
  it.each(['success', 'failure'] as const)(
    'keeps a newer rename intact when an older save finishes with %s',
    async (outcome) => {
      const oldSave = deferred()
      const newSave = deferred()
      const onSave = vi
        .fn()
        .mockReturnValueOnce(oldSave.promise)
        .mockReturnValueOnce(newSave.promise)
      const { result } = renderRenameHook(onSave)
      act(() => result.current.startRename({ id: 'old', name: 'Old name' }))
      act(() => result.current.setValue('Old renamed'))
      let firstSave!: Promise<void>
      act(() => {
        firstSave = result.current.saveRename()
      })
      act(() => result.current.startRename({ id: 'new', name: 'New name' }))
      act(() => result.current.setValue('New renamed'))
      let secondSave!: Promise<void>
      act(() => {
        secondSave = result.current.saveRename()
      })
      await act(async () => {
        if (outcome === 'success') oldSave.resolve()
        else oldSave.reject(new Error('Save failed'))
        await firstSave
      })
      expect(result.current.editingId).toBe('new')
      expect(result.current.value).toBe('New renamed')
      expect(result.current.isSaving).toBe(true)
      await act(async () => {
        newSave.resolve()
        await secondSave
      })
      expect(result.current.editingId).toBeNull()
      expect(result.current.isSaving).toBe(false)
    }
  )

  it('allows retry after failure and prevents Enter plus blur from saving twice', async () => {
    const pending = deferred()
    const onSave = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const { result } = renderRenameHook(onSave)
    act(() => result.current.startRename({ id: 'workspace', name: 'Original' }))
    act(() => result.current.setValue('Renamed'))
    let save!: Promise<void>
    act(() => {
      save = result.current.saveRename()
      void result.current.saveRename()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('Save failed'))
      await save
    })
    expect(result.current.editingId).toBe('workspace')
    expect(result.current.value).toBe('Original')
    expect(result.current.isSaving).toBe(false)
    act(() => result.current.setValue('Retry'))
    await act(async () => {
      await result.current.saveRename()
    })
    expect(onSave).toHaveBeenLastCalledWith('workspace', 'Retry')
    expect(result.current.editingId).toBeNull()
  })
})
