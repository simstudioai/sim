/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTaskContext } = vi.hoisted(() => ({
  mockTaskContext: { isInsideTask: false },
}))

vi.mock('@trigger.dev/core/v3', () => ({
  taskContext: mockTaskContext,
}))

import {
  isInsideTriggerRun,
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'

describe('trigger runtime detection', () => {
  beforeEach(() => {
    mockTaskContext.isInsideTask = false
    resetInsideTriggerRunForTests()
  })

  afterEach(() => {
    mockTaskContext.isInsideTask = false
    resetInsideTriggerRunForTests()
  })

  it('reports no run when neither signal is present', () => {
    expect(isInsideTriggerRun()).toBe(false)
  })

  it('reports a run from the SDK ambient task context alone', () => {
    mockTaskContext.isInsideTask = true
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('reports a run from the init-hook marker alone', () => {
    markInsideTriggerRun()
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('is idempotent when marked repeatedly', () => {
    markInsideTriggerRun()
    markInsideTriggerRun()
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('keeps the marker on globalThis so a duplicated bundle still sees it', () => {
    markInsideTriggerRun()
    const carrier = globalThis as Record<symbol, unknown>
    expect(carrier[Symbol.for('sim.trigger-dev.inside-run')]).toBe(true)
  })
})
