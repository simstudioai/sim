import { describe, expect, it } from 'vitest'
import { normalizeToolAgentId } from '@/lib/mothership/request/metrics'

describe('normalizeToolAgentId', () => {
  it.each([
    { agentId: 'main', expected: 'main' },
    { agentId: 'workflow', expected: 'workflow' },
    { agentId: 'tenant-defined-agent', expected: 'other' },
    { agentId: '', expected: 'other' },
  ])('normalizes $agentId to $expected for every telemetry signal', ({ agentId, expected }) => {
    expect(normalizeToolAgentId(agentId)).toBe(expected)
  })
})
