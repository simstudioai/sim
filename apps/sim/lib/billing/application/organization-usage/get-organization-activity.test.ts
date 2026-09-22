/** @vitest-environment node */
import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'

const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  entitlement: vi.fn(),
  subscription: vi.fn(),
  summary: vi.fn(),
  breakdown: vi.fn(),
  workspace: vi.fn(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authority,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mocks.entitlement,
}))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))
vi.mock('@/lib/billing/core/organization-activity-queries', () => ({
  readActivitySummary: mocks.summary,
  readActivityBreakdown: mocks.breakdown,
  readActivityWorkspace: mocks.workspace,
}))

import {
  getOrganizationActivityBreakdown,
  getOrganizationActivitySummary,
} from '@/lib/billing/application/organization-usage/get-organization-activity'
import { activityMetrics } from '@/lib/billing/core/organization-activity'

const principal: SessionPrincipal = { kind: 'session', userId: 'admin', sessionId: 'session' }
const input = {
  organizationId: 'org',
  preset: 'custom' as const,
  timezone: 'America/Los_Angeles',
  startDate: new Date('2026-03-08'),
  endDate: new Date('2026-03-09'),
  workspaceId: 'workspace',
}
const breakdownInput = {
  ...input,
  dimension: 'workflow' as const,
  sort: 'failures' as const,
  page: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authority.mockResolvedValue(true)
  mocks.entitlement.mockResolvedValue(true)
  mocks.subscription.mockResolvedValue(null)
  mocks.workspace.mockResolvedValue({ id: 'workspace', name: 'Support' })
  mocks.summary.mockResolvedValue({ totals: activityMetrics(), series: [] })
  mocks.breakdown.mockResolvedValue({ rows: [], hasMore: false })
})

describe.each([
  [
    'summary',
    (actor: Principal) => getOrganizationActivitySummary.execute({ principal: actor, input }),
  ],
  [
    'breakdown',
    (actor: Principal) =>
      getOrganizationActivityBreakdown.execute({ principal: actor, input: breakdownInput }),
  ],
] as const)('organization activity %s authorization', (_name, run) => {
  it('rejects API keys before loading organization data', async () => {
    await expect(
      run({ kind: 'personal_api_key', userId: 'admin', keyId: 'key' })
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    expect(mocks.authority).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('requires current organization admin authority before checking entitlement or reading activity', async () => {
    mocks.authority.mockRejectedValue(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    await expect(run(principal)).rejects.toMatchObject({
      detailCode: 'ORGANIZATION_ADMIN_REQUIRED',
    })
    expect(mocks.authority).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ minimumRole: 'admin', principalKinds: ['session'] }),
      { organizationId: 'org' }
    )
    expect(mocks.entitlement).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(mocks.breakdown).not.toHaveBeenCalled()
  })

  it('enforces the enterprise or self-hosted entitlement', async () => {
    mocks.entitlement.mockResolvedValue(false)
    await expect(run(principal)).rejects.toMatchObject({ detailCode: 'ENTERPRISE_PLAN_REQUIRED' })
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('rejects a foreign or deleted workspace before any activity aggregation', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(run(principal)).rejects.toThrow('Workspace not found')
    expect(mocks.workspace).toHaveBeenCalledWith('org', 'workspace')
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(mocks.breakdown).not.toHaveBeenCalled()
  })
})

it('uses the same authorized scope and timezone for summaries and paginated breakdowns', async () => {
  const summary = await getOrganizationActivitySummary.execute({ principal, input })
  await getOrganizationActivityBreakdown.execute({ principal, input: breakdownInput })
  const scope = {
    organizationId: 'org',
    workspaceId: 'workspace',
    start: new Date('2026-03-08T08:00:00Z'),
    end: new Date('2026-03-10T07:00:00Z'),
  }
  expect(mocks.summary).toHaveBeenCalledWith(scope, 'day', 'America/Los_Angeles')
  expect(mocks.breakdown).toHaveBeenCalledWith(scope, 'workflow', 'failures', 2)
  expect(summary.workspace).toEqual({ id: 'workspace', name: 'Support' })
  expect(summary.series).toEqual([
    { timestamp: '2026-03-08T00:00:00', workflowRuns: 0, chatRuns: 0, failed: 0 },
    { timestamp: '2026-03-09T00:00:00', workflowRuns: 0, chatRuns: 0, failed: 0 },
  ])
})
