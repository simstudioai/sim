import { describe, expect, it } from 'vitest'
import { getToolDisplayTitle } from '@/lib/mothership/tools/tool-display'

describe('async agent titles', () => {
  const id = 'review-report-validatio-1'
  const names = new Map([[id, 'Review report validation']])

  it('preserves display names, wait modes, counts and unknown-ID fallbacks', () => {
    expect(getToolDisplayTitle('wait_agents', { agent_ids: [id] }, names)).toBe(
      'Waiting for Review report validation'
    )
    expect(
      getToolDisplayTitle('wait_agents', { agent_ids: [id, 'other-agent-2'], mode: 'any' }, names)
    ).toBe('Waiting for the first of Review report validation + 1')
    expect(getToolDisplayTitle('wait_agents', { agent_ids: ['other-agent-2'] }, names)).toBe(
      'Waiting for Other Agent'
    )
    expect(getToolDisplayTitle('wait_agents', { agent_ids: [] }, names)).toBe('Waiting for agents')
  })

  it.each([
    ['tail_agent', 'Checking on'],
    ['steer_agent', 'Steering'],
    ['interrupt_agent', 'Stopping'],
  ])('uses the same display name for %s', (tool, verb) => {
    expect(getToolDisplayTitle(tool, { agent_id: id }, names)).toBe(
      `${verb} Review report validation`
    )
  })
})
