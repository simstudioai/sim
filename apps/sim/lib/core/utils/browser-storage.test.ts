/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage, STORAGE_KEYS } from '@/lib/core/utils/browser-storage'
import type { ChatContext } from '@/stores/panel'

describe('MothershipHandoffStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a handoff and trims the message, preserving contexts', () => {
    const contexts: ChatContext[] = [{ kind: 'logs', executionId: 'run-1', label: 'My Flow' }]
    expect(MothershipHandoffStorage.store({ message: '  fix it  ', contexts })).toBe(true)

    expect(MothershipHandoffStorage.consume()).toEqual({ message: 'fix it', contexts })
  })

  it('is one-shot — a second consume returns null', () => {
    MothershipHandoffStorage.store({ message: 'fix it' })

    expect(MothershipHandoffStorage.consume()).not.toBeNull()
    expect(MothershipHandoffStorage.consume()).toBeNull()
  })

  it('refuses to store an empty message', () => {
    expect(MothershipHandoffStorage.store({ message: '   ' })).toBe(false)
    expect(MothershipHandoffStorage.consume()).toBeNull()
  })

  it('tombstones a corrupted entry (missing timestamp) instead of leaving it forever', () => {
    localStorage.setItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF, JSON.stringify({ message: 'fix it' }))

    expect(MothershipHandoffStorage.consume()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
  })

  it('drops and clears a handoff older than maxAge', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      MothershipHandoffStorage.store({ message: 'fix it' })

      vi.advanceTimersByTime(61 * 1000)

      expect(MothershipHandoffStorage.consume()).toBeNull()
      expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
