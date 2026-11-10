import { vi } from 'vitest'

/** jsdom has no `ResizeObserver`, which measuring components construct on mount. */
export function stubResizeObserver() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
}

/**
 * jsdom has no modal `<dialog>` methods, which EMCN's Modal calls to open and close. The stubs
 * toggle `open` and fire `close`, as a browser does.
 */
export function stubDialog() {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
    close(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    },
  })
}
