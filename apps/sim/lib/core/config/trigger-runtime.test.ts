import { taskContext } from '@trigger.dev/core/v3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isInsideTriggerRun,
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'

/** The global `@trigger.dev/core/v3` mock's ambient context, mutated per test. */
const mockTaskContext = taskContext as { isInsideTask: boolean }

describe('trigger runtime detection', () => {
  beforeEach(() => {
    mockTaskContext.isInsideTask = false
    resetInsideTriggerRunForTests()
  })

  afterEach(() => {
    mockTaskContext.isInsideTask = false
    resetInsideTriggerRunForTests()
  })

  it('reports a run from the SDK ambient task context alone', () => {
    mockTaskContext.isInsideTask = true
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('reports a run from the init-hook marker alone', () => {
    markInsideTriggerRun()
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('keeps the marker on globalThis so a duplicated bundle still sees it', () => {
    markInsideTriggerRun()
    const carrier = globalThis as Record<symbol, unknown>
    expect(carrier[Symbol.for('sim.trigger-dev.inside-run')]).toBe(true)
  })
})
