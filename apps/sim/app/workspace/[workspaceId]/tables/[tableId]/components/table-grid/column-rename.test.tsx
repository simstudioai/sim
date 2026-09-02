/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  persistColumnRename,
  tryStartColumnRename,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/column-rename'
import { useInlineRename } from '@/hooks/use-inline-rename'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('column rename persistence', () => {
  it('does not register undo history when persistence rejects', async () => {
    const error = new Error('rename rejected')
    const pushUndo = vi.fn()
    const onRenamed = vi.fn()

    await expect(
      persistColumnRename({
        columnId: 'column-1',
        oldName: 'Original',
        newName: 'Updated',
        persist: () => Promise.reject(error),
        pushUndo,
        onRenamed,
      })
    ).rejects.toBe(error)

    expect(pushUndo).not.toHaveBeenCalled()
    expect(onRenamed).not.toHaveBeenCalled()
  })
})

describe('column rename sessions', () => {
  let container: HTMLDivElement
  let root: Root
  let rename: ReturnType<typeof useInlineRename>

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('refuses a second session until the pending rename settles', async () => {
    const deferred = createDeferred()

    function Harness() {
      rename = useInlineRename({ onSave: () => deferred.promise })
      return null
    }

    act(() => root.render(<Harness />))
    act(() => {
      expect(tryStartColumnRename(rename, 'column-1', 'First')).toBe(true)
    })
    act(() => rename.setEditValue('Renamed first'))

    let pendingRename: Promise<void>
    act(() => {
      pendingRename = rename.submitRename()
    })

    expect(rename.isSaving).toBe(true)
    act(() => {
      expect(tryStartColumnRename(rename, 'column-2', 'Second')).toBe(false)
    })
    expect(rename.editingId).toBe('column-1')

    await act(async () => {
      deferred.resolve()
      await pendingRename
    })

    expect(rename.isSaving).toBe(false)
    act(() => {
      expect(tryStartColumnRename(rename, 'column-2', 'Second')).toBe(true)
    })
    expect(rename.editingId).toBe('column-2')
  })
})
