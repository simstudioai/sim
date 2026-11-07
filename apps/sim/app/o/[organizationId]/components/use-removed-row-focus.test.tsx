/** @vitest-environment jsdom */

import { act, useRef, useState } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@/platform/design-system/components/modal/confirm-dialog'
import { useRemovedRowFocus } from '@/platform/shared/use-removed-row-focus'

const previousFocus = new WeakMap<HTMLDialogElement, HTMLElement | null>()

/** jsdom has no `<dialog>` methods. Unlike the shared stub, `close` hands focus back as a browser does. */
function stubNativeDialog() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    previousFocus.set(this, document.activeElement as HTMLElement | null)
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
    previousFocus.get(this)?.focus()
  }
}

interface Harness {
  /** Takes the row out of the list, as the mutation's refetch does. */
  dropRow: (id: string) => void
}

function RemovableRows({
  initial,
  remove,
  harness,
  renderBeforeClosing,
}: {
  initial: readonly string[]
  remove: (id: string, drop: (id: string) => void) => Promise<void>
  harness: Harness
  renderBeforeClosing: boolean
}) {
  const [rows, setRows] = useState(initial)
  const [, setRenders] = useState(0)
  const [removing, setRemoving] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const removeRow = useRemovedRowFocus({
    rowIds: rows,
    rowAt: (index) => list.current?.children[index],
    list,
    confirming: removing !== null,
  })
  const drop = (id: string) => setRows((current) => current.filter((row) => row !== id))
  harness.dropRow = drop
  return (
    <>
      <button type='button'>Outside</button>
      <div ref={list} data-testid='list'>
        {rows.map((id) => (
          <div key={id}>
            <span>{id}</span>
            <button type='button' onClick={() => setRemoving(id)}>
              {`Remove ${id}`}
            </button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        target={removing !== null}
        onClose={() => setRemoving(null)}
        title='Remove'
        confirmLabel='Confirm'
        pendingLabel='Removing'
        onConfirm={async () => {
          if (!removing) return
          await removeRow(removing, () => remove(removing, drop))
          if (renderBeforeClosing) flushSync(() => setRenders((count) => count + 1))
        }}
      />
    </>
  )
}

function button(name: string) {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name
  )
  if (!found) throw new Error(`No button named ${name}`)
  return found
}

async function openConfirm(rowName: string) {
  const trigger = button(`Remove ${rowName}`)
  await act(async () => {
    trigger.focus()
    trigger.click()
  })
}

describe('useRemovedRowFocus', () => {
  let container: HTMLDivElement
  let root: Root
  const harness: Harness = { dropRow: () => {} }

  beforeEach(() => {
    stubResizeObserver()
    stubNativeDialog()
    Element.prototype.checkVisibility = () => true
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function render(
    rows: readonly string[],
    remove: (id: string, drop: (id: string) => void) => Promise<void>,
    renderBeforeClosing = false
  ) {
    await act(async () => {
      root.render(
        <RemovableRows
          initial={rows}
          remove={remove}
          harness={harness}
          renderBeforeClosing={renderBeforeClosing}
        />
      )
    })
  }

  it('moves to the next row when the row goes before the confirm closes', async () => {
    await render(['a', 'b', 'c'], async (id, drop) => drop(id))
    await openConfirm('b')
    await act(async () => button('Confirm').click())
    expect(document.activeElement).toBe(button('Remove c'))
  })

  it('moves to the next row when the row goes after the confirm closes', async () => {
    await render(['a', 'b', 'c'], async () => {})
    await openConfirm('b')
    await act(async () => button('Confirm').click())
    expect(document.activeElement).toBe(button('Remove b'))
    await act(async () => harness.dropRow('b'))
    expect(document.activeElement).toBe(button('Remove c'))
  })

  it('still moves when a render lands while the confirm is closing', async () => {
    await render(['a', 'b', 'c'], async (id, drop) => drop(id), true)
    await openConfirm('b')
    await act(async () => button('Confirm').click())
    expect(document.activeElement).toBe(button('Remove c'))
  })

  it('moves to the row before when the last row goes', async () => {
    await render(['a', 'b'], async (id, drop) => drop(id))
    await openConfirm('b')
    await act(async () => button('Confirm').click())
    expect(document.activeElement).toBe(button('Remove a'))
  })

  it('moves to the list when no row is left', async () => {
    await render(['a'], async (id, drop) => drop(id))
    await openConfirm('a')
    await act(async () => button('Confirm').click())
    expect(document.activeElement).toBe(document.querySelector('[data-testid="list"]'))
  })

  it('leaves focus on the trigger when the confirm is cancelled', async () => {
    await render(['a', 'b'], async (id, drop) => drop(id))
    await openConfirm('a')
    await act(async () => button('Cancel').click())
    expect(document.activeElement).toBe(button('Remove a'))
  })

  it('keeps the row and its focus when the removal fails', async () => {
    await render(['a', 'b'], async () => {
      throw new Error('refused')
    })
    await openConfirm('a')
    await act(async () => button('Confirm').click())
    expect(button('Remove a')).toBeTruthy()
    await act(async () => button('Cancel').click())
    expect(document.activeElement).toBe(button('Remove a'))
  })

  it('arms nothing when the removal fails, so a later change cannot move focus', async () => {
    await render(['a', 'b'], async () => {
      throw new Error('refused')
    })
    await openConfirm('a')
    await act(async () => button('Confirm').click())
    await act(async () => button('Cancel').click())
    await act(async () => button('Remove a').blur())
    await act(async () => harness.dropRow('a'))
    expect(document.activeElement).toBe(document.body)
  })

  it('does not take focus from where the viewer moved it before the row went', async () => {
    await render(['a', 'b'], async () => {})
    await openConfirm('a')
    await act(async () => button('Confirm').click())
    await act(async () => button('Outside').focus())
    await act(async () => harness.dropRow('a'))
    expect(document.activeElement).toBe(button('Outside'))
  })
})
