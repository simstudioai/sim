export type EventSourceOpenReason = 'initial' | 'reconnect' | 'rotation'

interface RotatingEventSourceOptions {
  url: string
  events: Record<string, (event: Event) => void>
  onOpen?: (reason: EventSourceOpenReason) => void
  onError?: () => void
}

export interface RotatingEventSourceConnection {
  close(): void
}

interface SourceState {
  opened: boolean
  erroredBeforeOpen: boolean
}

/**
 * Maintains one live EventSource and performs make-before-break rotation when
 * the server emits `rotate`. The old source remains open until its replacement
 * connects, so planned lifetime bounds do not create an event-delivery gap.
 */
export function createRotatingEventSource(
  options: RotatingEventSourceOptions
): RotatingEventSourceConnection {
  const sources = new Set<EventSource>()
  const states = new WeakMap<EventSource, SourceState>()
  let current: EventSource | null = null
  let replacement: EventSource | null = null
  let closed = false

  const openSource = (isReplacement: boolean): EventSource => {
    const source = new EventSource(options.url)
    const state: SourceState = { opened: false, erroredBeforeOpen: false }
    states.set(source, state)
    sources.add(source)

    for (const [eventName, listener] of Object.entries(options.events)) {
      source.addEventListener(eventName, listener)
    }

    source.addEventListener('rotate', () => {
      if (closed || source !== current || replacement) return
      try {
        replacement = openSource(true)
      } catch {
        replacement = null
        options.onError?.()
      }
    })

    source.onopen = () => {
      if (closed) {
        source.close()
        sources.delete(source)
        return
      }

      if (isReplacement) {
        if (source !== replacement) {
          source.close()
          sources.delete(source)
          return
        }

        const previous = current
        const seamless = previous?.readyState === EventSource.OPEN
        current = source
        replacement = null
        if (previous && previous !== source) {
          previous.close()
          sources.delete(previous)
        }
        state.opened = true
        state.erroredBeforeOpen = false
        options.onOpen?.(seamless ? 'rotation' : 'reconnect')
        return
      }

      const reason: EventSourceOpenReason =
        state.opened || state.erroredBeforeOpen ? 'reconnect' : 'initial'
      state.opened = true
      state.erroredBeforeOpen = false
      options.onOpen?.(reason)
    }

    source.onerror = () => {
      if (closed || !sources.has(source)) return
      if (!state.opened) state.erroredBeforeOpen = true
      options.onError?.()
    }

    return source
  }

  current = openSource(false)

  return {
    close() {
      if (closed) return
      closed = true
      for (const source of sources) {
        source.close()
      }
      sources.clear()
      current = null
      replacement = null
    },
  }
}
