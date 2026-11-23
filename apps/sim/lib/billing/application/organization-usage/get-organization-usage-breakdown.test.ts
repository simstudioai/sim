import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadUsageGroups, mockReadUsageEntities } = vi.hoisted(() => ({
  mockReadUsageGroups: vi.fn(),
  mockReadUsageEntities: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageGroups: mockReadUsageGroups,
  readUsageEntities: mockReadUsageEntities,
}))

import { buildUsageBreakdown } from '@/lib/billing/application/organization-usage/get-organization-usage-breakdown'
import type { UsageBreakdownDimension } from '@/lib/billing/core/usage-analytics'

function breakdown(dimension: UsageBreakdownDimension) {
  return buildUsageBreakdown({
    entity: { type: 'organization', id: 'org-1' },
    window: { kind: 'range', from: new Date('2026-01-01'), to: new Date('2026-01-08') },
    timezone: 'UTC',
    dimension,
    limit: 10,
  })
}

describe('buildUsageBreakdown model attribution', () => {
  beforeEach(() => {
    mockReadUsageEntities.mockResolvedValue(new Map())
  })

  it('marks a sim-auto model row as Auto, never as an Ollama model', async () => {
    mockReadUsageGroups.mockResolvedValue([
      { key: 'sim-auto', cost: 2, events: 2 },
      { key: 'claude-sonnet-5-5', cost: 1, events: 1 },
      { key: 'llama3.1:8b', cost: 0.5, events: 1 },
    ])

    const { rows } = await breakdown('model')

    expect(rows.map(({ id, label, providerId }) => ({ id, label, providerId }))).toEqual([
      { id: 'sim-auto', label: 'Auto', providerId: 'sim-auto' },
      { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', providerId: 'anthropic' },
      { id: 'llama3.1:8b', label: 'llama3.1:8b', providerId: 'ollama' },
    ])
  })

  it('keeps BYOK sim-auto usage as its own Auto row rather than merging it into Ollama', async () => {
    mockReadUsageGroups.mockResolvedValue([
      { key: 'sim-auto', cost: 0, events: 1, inputTokens: 100, outputTokens: 50 },
      { key: 'ollama/llama3', cost: 0, events: 1, inputTokens: 10, outputTokens: 5 },
    ])

    const { rows } = await breakdown('byok')

    expect(rows.map(({ id, label, tokens }) => ({ id, label, tokens }))).toEqual([
      { id: 'sim-auto', label: 'Auto', tokens: 150 },
      { id: 'ollama', label: 'Ollama', tokens: 15 },
    ])
  })
})
