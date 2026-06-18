/**
 * @vitest-environment node
 *
 * Tests for the `createStableFlagController` state machine behind `useStableFlag`.
 * The controller is framework-agnostic so the anti-flicker timing can be driven
 * with fake timers and no DOM; the thin React wrapper is covered by manual QA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStableFlagController } from '@/hooks/use-stable-flag'

const DELAY_MS = 2000
const MIN_VISIBLE_MS = 1500

function setup(options = { delayMs: DELAY_MS, minVisibleMs: MIN_VISIBLE_MS }) {
  const states: boolean[] = []
  let active = false
  const controller = createStableFlagController((next) => {
    active = next
    states.push(next)
  }, options)
  return {
    controller,
    states,
    get active() {
      return active
    },
  }
}

describe('createStableFlagController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('suppresses a blip that heals before the delay (flash-on)', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS - 1)
    probe.controller.setValue(false)
    vi.advanceTimersByTime(10_000)

    expect(probe.states).toEqual([])
    expect(probe.active).toBe(false)
  })

  it('does not turn on one tick before the delay boundary', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS - 1)

    expect(probe.active).toBe(false)
    expect(probe.states).toEqual([])
  })

  it('turns on exactly at the delay boundary', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS)

    expect(probe.states).toEqual([true])
    expect(probe.active).toBe(true)
  })

  it('holds the flag on for the minimum-visible window (flash-off)', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS) // shown
    expect(probe.active).toBe(true)

    // Value clears almost immediately after showing.
    vi.advanceTimersByTime(100)
    probe.controller.setValue(false)
    expect(probe.active).toBe(true) // still held

    vi.advanceTimersByTime(MIN_VISIBLE_MS - 100 - 1)
    expect(probe.active).toBe(true)

    vi.advanceTimersByTime(1)
    expect(probe.active).toBe(false)
    expect(probe.states).toEqual([true, false])
  })

  it('clears immediately when the value has already been visible past the minimum', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS)
    vi.advanceTimersByTime(MIN_VISIBLE_MS + 500) // well past the floor
    probe.controller.setValue(false)

    expect(probe.active).toBe(false)
    expect(probe.states).toEqual([true, false])
  })

  it('keeps the flag on through a flap while held, without re-delaying', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS) // shown
    probe.controller.setValue(false) // schedules hide
    vi.advanceTimersByTime(500)
    probe.controller.setValue(true) // reconnect flaps back before hide fires

    vi.advanceTimersByTime(10_000)
    expect(probe.active).toBe(true)
    expect(probe.states).toEqual([true])
  })

  it('is idempotent on repeated setValue(true) — schedules a single show', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(500)
    probe.controller.setValue(true)
    probe.controller.setValue(true)

    vi.advanceTimersByTime(DELAY_MS - 500)
    expect(probe.states).toEqual([true]) // exactly one transition, fired at the original deadline
  })

  it('dispose cancels a pending show', () => {
    const probe = setup()

    probe.controller.setValue(true)
    probe.controller.dispose()
    vi.advanceTimersByTime(10_000)

    expect(probe.states).toEqual([])
  })

  it('dispose cancels a pending hide', () => {
    const probe = setup()

    probe.controller.setValue(true)
    vi.advanceTimersByTime(DELAY_MS)
    probe.controller.setValue(false) // schedules hide within min-visible window
    probe.controller.dispose()
    vi.advanceTimersByTime(10_000)

    expect(probe.states).toEqual([true]) // hide never fired
  })

  it('with zero options, mirrors the value on the next tick', () => {
    const probe = setup({ delayMs: 0, minVisibleMs: 0 })

    probe.controller.setValue(true)
    vi.advanceTimersByTime(0)
    expect(probe.active).toBe(true)

    probe.controller.setValue(false)
    expect(probe.active).toBe(false)
    expect(probe.states).toEqual([true, false])
  })
})
