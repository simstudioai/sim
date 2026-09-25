import type { SessionPrincipal } from '@sim/auth/principal'
import { setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeOrganizationOperation: vi.fn(),
  isOrganizationFeatureEntitled: vi.fn(),
  getOrganizationSubscription: vi.fn(),
  getOrgUsageLimit: vi.fn(),
  readUsageDays: vi.fn(),
  readUsageGroups: vi.fn(),
  readUsageEntities: vi.fn(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeOrganizationOperation,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mocks.isOrganizationFeatureEntitled,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mocks.getOrganizationSubscription,
}))
vi.mock('@/lib/billing/core/usage', () => ({ getOrgUsageLimit: mocks.getOrgUsageLimit }))
vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageDays: mocks.readUsageDays,
  readUsageGroups: mocks.readUsageGroups,
  readUsageEntities: mocks.readUsageEntities,
}))
vi.mock('@/providers/models', () => ({
  getProviderFromModel: () => 'openai',
  PROVIDER_DEFINITIONS: {},
}))

import { getOrganizationUsageOverview } from '@/lib/billing/application/organization-usage/get-organization-usage-overview'

const session: SessionPrincipal = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' }
const NOW = new Date()
const day = NOW.toISOString().slice(0, 10)
const today = `${day}T00:00:00`

function run(input: Partial<Parameters<typeof getOrganizationUsageOverview.execute>[0]['input']>) {
  return getOrganizationUsageOverview.execute({
    principal: session,
    input: { organizationId: 'org-1', preset: '7d', timezone: 'UTC', ...input },
  })
}

describe('getOrganizationUsageOverview', () => {
  beforeEach(() => {
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mocks.authorizeOrganizationOperation.mockResolvedValue(true)
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(true)
    mocks.getOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      seats: 1,
      periodStart: new Date(NOW.getTime() - 10 * 86_400_000),
      periodEnd: new Date(NOW.getTime() + 20 * 86_400_000),
    })
    mocks.getOrgUsageLimit.mockResolvedValue({ limit: 100, minimum: 100 })
    mocks.readUsageDays.mockResolvedValue([
      [
        day,
        [
          { key: 'workflow', cost: 0.0104, events: 3 },
          { key: 'copilot', cost: 0.0033, events: 1 },
          { key: 'workspace-chat', cost: 0.0033, events: 1 },
        ],
      ],
    ])
    mocks.readUsageGroups.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        key: `u${index}`,
        cost: 0.01 * (7 - index),
        events: 1,
      }))
    )
    mocks.readUsageEntities.mockImplementation(
      async (_dimension: string, ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            { name: `Member ${id}`, ...(id === 'u0' ? { image: 'a.png' } : {}) },
          ])
        )
    )
  })

  afterAll(() => {
    setEnvFlags({ isBillingEnabled: false, isHosted: false })
  })

  it('reads names only for the kept rows, however large a tie at the cutoff', async () => {
    mocks.readUsageGroups.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        key: `u${String(index).padStart(2, '0')}`,
        cost: 0.01,
        events: 1,
      }))
    )
    mocks.readUsageEntities.mockImplementation(
      async (_dimension: string, ids: string[]) =>
        new Map(ids.map((id) => [id, { name: `Member ${id}` }]))
    )
    const { members } = await run({})
    expect(mocks.readUsageEntities.mock.calls[0]?.[1]).toEqual(['u00', 'u01', 'u02', 'u03', 'u04'])
    expect(members.rows.map((row) => row.label)).toEqual([
      'Member u00',
      'Member u01',
      'Member u02',
      'Member u03',
      'Member u04',
    ])
    expect(members.other.rowCount).toBe(7)
  })

  it('reconciles the stack and the headline to one figure', async () => {
    const result = await run({})
    const point = result.series.find((entry) => entry.timestamp === today)
    const stacked = Object.values(point?.sources ?? {}).reduce((sum, value) => sum + value, 0)
    const bars = result.series.reduce((sum, entry) => sum + entry.credits, 0)

    expect(result.totals.credits).toBe(3)
    expect(stacked).toBe(result.totals.credits)
    expect(bars).toBe(result.totals.credits)
  })

  it('merges the ledger sources that display as one before rounding them', async () => {
    const point = (await run({})).series.find((entry) => entry.timestamp === today)
    // `copilot` and `workspace-chat` are two ledger sources and one displayed source.
    expect(point?.sources).toEqual({ workflow: 2, 'sim-chat': 1 })
  })

  it('compares a rolling window with the span just before it', async () => {
    mocks.readUsageDays.mockResolvedValueOnce([[day, [{ key: 'workflow', cost: 0.02, events: 1 }]]])
    mocks.readUsageDays.mockResolvedValueOnce([[day, [{ key: 'workflow', cost: 0.01, events: 1 }]]])
    const result = await run({ preset: '30d' })
    expect(result.totals.credits).toBe(4)
    expect(result.previousTotals).toEqual({ credits: 2 })
  })

  it('narrows every read, including the comparison window, to the drill-down workspace', async () => {
    await run({ workspaceId: 'ws-1' })
    expect(mocks.readUsageDays).toHaveBeenCalledTimes(2)
    for (const [args] of mocks.readUsageDays.mock.calls) expect(args.workspaceId).toBe('ws-1')
    expect(mocks.readUsageGroups).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' })
    )
  })
})
