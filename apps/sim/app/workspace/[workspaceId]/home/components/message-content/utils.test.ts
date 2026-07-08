/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deriveMessagePhase, resolveToolDisplayState } from './utils'

describe('deriveMessagePhase', () => {
  it('is streaming whenever the transport is live', () => {
    expect(deriveMessagePhase({ isStreaming: true, isRevealing: false })).toBe('streaming')
    expect(deriveMessagePhase({ isStreaming: true, isRevealing: true })).toBe('streaming')
  })

  it('is revealing when the transport stopped but text is still draining', () => {
    expect(deriveMessagePhase({ isStreaming: false, isRevealing: true })).toBe('revealing')
  })

  it('is settled once neither the transport nor the reveal is active', () => {
    expect(deriveMessagePhase({ isStreaming: false, isRevealing: false })).toBe('settled')
  })
})

describe('resolveToolDisplayState', () => {
  it('spins iff the tool is executing — a pure projection of its own status', () => {
    expect(resolveToolDisplayState('executing')).toBe('spinner')
  })

  it('maps cancelled and interrupted to their own glyphs', () => {
    expect(resolveToolDisplayState('cancelled')).toBe('cancelled')
    expect(resolveToolDisplayState('interrupted')).toBe('interrupted')
  })

  it('renders terminal successes and errors as the tool icon', () => {
    expect(resolveToolDisplayState('success')).toBe('icon')
    expect(resolveToolDisplayState('error')).toBe('icon')
    expect(resolveToolDisplayState('skipped')).toBe('icon')
    expect(resolveToolDisplayState('rejected')).toBe('icon')
  })
})
