import { describe, expect, it, vi } from 'vitest'
import { createSleepBlocker } from '@/main/desktop-executor/sleep-blocker'

function harness(enabled = true) {
  let nextId = 1
  const active = new Set<number>()
  const powerSaveBlocker = {
    start: vi.fn(() => {
      const id = nextId++
      active.add(id)
      return id
    }),
    stop: vi.fn((id: number) => {
      active.delete(id)
    }),
    isStarted: (id: number) => active.has(id),
  }
  let preference = enabled
  const blocker = createSleepBlocker({ enabled: () => preference, powerSaveBlocker })
  return {
    blocker,
    powerSaveBlocker,
    active,
    setPreference: (value: boolean) => {
      preference = value
      blocker.refresh()
    },
  }
}

describe('keeping the machine awake for background work', () => {
  it('holds one blocker only while a chat has work running', () => {
    const { blocker, powerSaveBlocker, active } = harness()

    blocker.setBusy(true)
    blocker.setBusy(true)
    expect(active.size).toBe(1)
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')

    blocker.setBusy(false)
    expect(active.size).toBe(0)
  })

  it('never holds one while the user has switched it off, and follows the switch live', () => {
    const { blocker, active, setPreference } = harness(false)

    blocker.setBusy(true)
    expect(active.size).toBe(0)

    setPreference(true)
    expect(active.size).toBe(1)
    setPreference(false)
    expect(active.size).toBe(0)
  })

  it('does not start one for an idle machine when the switch turns on', () => {
    const { active, setPreference } = harness(false)

    setPreference(true)

    expect(active.size).toBe(0)
  })
})
