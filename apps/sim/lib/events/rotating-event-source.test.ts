/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRotatingEventSource,
  type EventSourceOpenReason,
} from '@/lib/events/rotating-event-source'

class MockEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: MockEventSource[] = []
  static failNextConstruction = false

  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  readyState = MockEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    if (MockEventSource.failNextConstruction) {
      MockEventSource.failNextConstruction = false
      throw new Error('construction failed')
    }
    MockEventSource.instances.push(this)
  }

  addEventListener(eventName: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(eventName) ?? []
    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
  }

  open(): void {
    this.readyState = MockEventSource.OPEN
    this.onopen?.()
  }

  error(): void {
    this.readyState = MockEventSource.CONNECTING
    this.onerror?.()
  }

  emit(eventName: string): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(new Event(eventName))
    }
  }
}

describe('createRotatingEventSource', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    MockEventSource.failNextConstruction = false
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the current source open until its replacement connects', () => {
    const reasons: EventSourceOpenReason[] = []
    const onMessage = vi.fn()
    const connection = createRotatingEventSource({
      url: '/api/events',
      events: { message: onMessage },
      onOpen: (reason) => reasons.push(reason),
    })
    const first = MockEventSource.instances[0]
    first.open()
    first.emit('message')

    first.emit('rotate')

    expect(MockEventSource.instances).toHaveLength(2)
    expect(first.readyState).toBe(MockEventSource.OPEN)

    const second = MockEventSource.instances[1]
    second.open()
    second.emit('message')

    expect(first.readyState).toBe(MockEventSource.CLOSED)
    expect(second.readyState).toBe(MockEventSource.OPEN)
    expect(reasons).toEqual(['initial', 'rotation'])
    expect(onMessage).toHaveBeenCalledTimes(2)
    connection.close()
  })

  it('classifies a replacement as reconnecting when the old source dropped first', () => {
    const reasons: EventSourceOpenReason[] = []
    const onMessage = vi.fn()
    const connection = createRotatingEventSource({
      url: '/api/events',
      events: { message: onMessage },
      onOpen: (reason) => reasons.push(reason),
    })
    const first = MockEventSource.instances[0]
    first.open()
    first.emit('rotate')
    first.error()

    const second = MockEventSource.instances[1]
    second.open()
    second.emit('message')

    expect(reasons).toEqual(['initial', 'reconnect'])
    expect(onMessage).toHaveBeenCalledTimes(1)
    connection.close()
  })

  it('classifies an automatic EventSource recovery as a reconnect', () => {
    const reasons: EventSourceOpenReason[] = []
    const connection = createRotatingEventSource({
      url: '/api/events',
      events: {},
      onOpen: (reason) => reasons.push(reason),
    })
    const source = MockEventSource.instances[0]
    source.open()
    source.error()
    source.open()

    expect(reasons).toEqual(['initial', 'reconnect'])
    connection.close()
  })

  it('closes both sources when disposed during rotation', () => {
    const connection = createRotatingEventSource({ url: '/api/events', events: {} })
    const first = MockEventSource.instances[0]
    first.open()
    first.emit('rotate')
    const second = MockEventSource.instances[1]

    connection.close()

    expect(first.readyState).toBe(MockEventSource.CLOSED)
    expect(second.readyState).toBe(MockEventSource.CLOSED)
  })

  it('keeps the current source when opening its replacement fails', () => {
    const onError = vi.fn()
    const connection = createRotatingEventSource({ url: '/api/events', events: {}, onError })
    const first = MockEventSource.instances[0]
    first.open()
    MockEventSource.failNextConstruction = true

    first.emit('rotate')

    expect(first.readyState).toBe(MockEventSource.OPEN)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    connection.close()
  })
})
