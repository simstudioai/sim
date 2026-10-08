/**
 * chai 6 announces plugin registration through a module-level `EventTarget` and an `Event`
 * subclass. A bare isolate has neither, so the vitest-expect bundle imports this first.
 */

type Listener = (event: { type: string }) => void

const g: typeof globalThis & { Event?: unknown; EventTarget?: unknown } = globalThis

if (typeof g.Event === 'undefined') {
  g.Event = class Event {
    readonly type: string
    constructor(type: string) {
      this.type = type
    }
  }
}

if (typeof g.EventTarget === 'undefined') {
  g.EventTarget = class EventTarget {
    readonly #listeners = new Map<string, Set<Listener>>()

    addEventListener(type: string, listener: Listener): void {
      const listeners = this.#listeners.get(type) ?? new Set<Listener>()
      listeners.add(listener)
      this.#listeners.set(type, listeners)
    }

    removeEventListener(type: string, listener: Listener): void {
      this.#listeners.get(type)?.delete(listener)
    }

    dispatchEvent(event: { type: string }): boolean {
      for (const listener of this.#listeners.get(event.type) ?? []) listener(event)
      return true
    }
  }
}
