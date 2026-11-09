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
