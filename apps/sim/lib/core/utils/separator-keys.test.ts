/**
 * @vitest-environment node
 */
import type { KeyboardEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { readSeparatorKey } from '@/lib/core/utils/separator-keys'

function keyEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    keyCode: 0,
    nativeEvent: { isComposing: false },
    ...init,
  } as KeyboardEvent
}

describe('readSeparatorKey', () => {
  it('maps arrows to directions and Home/End to bounds', () => {
    expect(readSeparatorKey(keyEvent('ArrowLeft'))).toBe('left')
    expect(readSeparatorKey(keyEvent('ArrowRight'))).toBe('right')
    expect(readSeparatorKey(keyEvent('Home'))).toBe('min')
    expect(readSeparatorKey(keyEvent('End'))).toBe('max')
  })

  it('ignores other keys, modified presses, and IME composition', () => {
    expect(readSeparatorKey(keyEvent('ArrowUp'))).toBeNull()
    expect(readSeparatorKey(keyEvent('Enter'))).toBeNull()
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(readSeparatorKey(keyEvent('ArrowLeft', { [modifier]: true }))).toBeNull()
    }
    expect(
      readSeparatorKey(keyEvent('ArrowLeft', { nativeEvent: { isComposing: true } } as never))
    ).toBeNull()
    expect(readSeparatorKey(keyEvent('ArrowLeft', { keyCode: 229 }))).toBeNull()
  })
})
