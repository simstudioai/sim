/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

/**
 * Chromium's close watcher stops honoring `preventDefault` on `cancel` once the page's user
 * activation is spent: Escape then closes the dialog natively and only `close` is left to react to.
 */
function closeNatively(dialog: HTMLDialogElement) {
  dialog.removeAttribute('open')
  dialog.dispatchEvent(new Event('close'))
}

describe('OverlayDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const onClose = vi.fn()

  const render = (busy: boolean) =>
    act(async () => {
      root.render(
        <OverlayDialog open title='Ban user' busy={busy} onClose={onClose}>
          <p>Body</p>
        </OverlayDialog>
      )
    })
  const dialog = () => container.querySelector('dialog') as HTMLDialogElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open')
    }
    onClose.mockReset()
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('reopens when the browser closes it while its work is running', async () => {
    await render(true)
    await act(async () => closeNatively(dialog()))

    expect(dialog().hasAttribute('open')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a native close when nothing is running, so its owner cannot stay open', async () => {
    await render(false)
    await act(async () => closeNatively(dialog()))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
