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

/** jsdom's `<dialog>` has no `showModal` or `close`; these only flip `open`. */
export function stubDialogMethods() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
  }
}
