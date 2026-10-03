import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasRecentDeliberateInput,
  hasRecentDiscreteInput,
  trackInputActivity,
} from '@/main/input-activity'

type InputListener = (event: unknown, input: { type: string }) => void

function fakeContents(destroyed = false) {
  const listeners: InputListener[] = []
  const contents = {
    isDestroyed: () => destroyed,
    on: (channel: string, listener: InputListener) => {
      if (channel === 'input-event') listeners.push(listener)
    },
  }
  trackInputActivity(contents as unknown as WebContents)
  return {
    contents: contents as unknown as WebContents,
    send: (type: string) => {
      for (const listener of listeners) listener({}, { type })
    },
  }
}

describe('input activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores the passive pointer stream a page gets for free', () => {
    const { contents, send } = fakeContents()

    for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'pointerMove']) send(type)

    expect(hasRecentDeliberateInput(contents)).toBe(false)
    expect(hasRecentDiscreteInput(contents)).toBe(false)
  })

  it('never reports input for a destroyed renderer', () => {
    const { contents, send } = fakeContents(true)

    send('keyDown')

    expect(hasRecentDeliberateInput(contents)).toBe(false)
    expect(hasRecentDiscreteInput(contents)).toBe(false)
  })

  it('keeps activity separate per renderer', () => {
    const first = fakeContents()
    const second = fakeContents()

    first.send('keyDown')

    expect(hasRecentDeliberateInput(first.contents)).toBe(true)
    expect(hasRecentDeliberateInput(second.contents)).toBe(false)
  })
})
