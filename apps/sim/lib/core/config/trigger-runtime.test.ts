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
    vi.unstubAllEnvs()
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

  it('pins outgoing work to the executing deployment on repeated initialization', () => {
    vi.stubEnv('TRIGGER_VERSION', 'older-version')
    markInsideTriggerRun('20260909.44')
    markInsideTriggerRun('20260909.44')
    expect(process.env.TRIGGER_VERSION).toBe('20260909.44')
    expect(isInsideTriggerRun()).toBe(true)
  })

  it('preserves local configuration without a deployment version', () => {
    vi.stubEnv('TRIGGER_VERSION', undefined)
    markInsideTriggerRun()
    expect(process.env.TRIGGER_VERSION).toBeUndefined()
    vi.stubEnv('TRIGGER_VERSION', 'local-override')
    markInsideTriggerRun()
    expect(process.env.TRIGGER_VERSION).toBe('local-override')
  })

  it('keeps the marker on globalThis so a duplicated bundle still sees it', () => {
    markInsideTriggerRun()
    const carrier = globalThis as Record<symbol, unknown>
    expect(carrier[Symbol.for('sim.trigger-dev.inside-run')]).toBe(true)
  })
})
