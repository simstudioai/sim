/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage, STORAGE_KEYS } from '@/lib/core/utils/browser-storage'
import type { ChatContext } from '@/stores/panel'

const WS = 'ws-1'

describe('MothershipHandoffStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a handoff and trims the message, preserving contexts', () => {
    const contexts: ChatContext[] = [{ kind: 'logs', executionId: 'run-1', label: 'My Flow' }]
    expect(MothershipHandoffStorage.store({ message: '  fix it  ', contexts }, WS)).toBe(true)

    expect(MothershipHandoffStorage.consume(WS)).toEqual({ message: 'fix it', contexts })
  })

  it('is one-shot — a second consume returns null', () => {
    MothershipHandoffStorage.store({ message: 'fix it' }, WS)

    expect(MothershipHandoffStorage.consume(WS)).not.toBeNull()
    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
  })

  it('refuses to store without a message or workspace', () => {
    expect(MothershipHandoffStorage.store({ message: '   ' }, WS)).toBe(false)
    expect(MothershipHandoffStorage.store({ message: 'fix it' }, '')).toBe(false)
    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
  })

  it('leaves a handoff owned by another workspace untouched for its owner', () => {
    MothershipHandoffStorage.store({ message: 'fix it' }, WS)

    // A different workspace must not claim it, and must not clear it.
    expect(MothershipHandoffStorage.consume('ws-other')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).not.toBeNull()

    // The owning workspace still consumes it.
    expect(MothershipHandoffStorage.consume(WS)).toEqual({ message: 'fix it', contexts: undefined })
  })

  it('tombstones a corrupted entry (missing timestamp) instead of leaving it forever', () => {
    localStorage.setItem(
      STORAGE_KEYS.MOTHERSHIP_HANDOFF,
      JSON.stringify({ message: 'fix it', workspaceId: WS })
    )

    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
  })

  it('drops and clears a handoff older than maxAge', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      MothershipHandoffStorage.store({ message: 'fix it' }, WS)

      vi.advanceTimersByTime(61 * 1000)

      expect(MothershipHandoffStorage.consume(WS)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
