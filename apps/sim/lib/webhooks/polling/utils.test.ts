/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpdate, mockSet, mockWhere, sqlCalls } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  sqlCalls: [] as Array<{ strings: readonly string[]; values: unknown[] }>,
}))

vi.mock('@sim/db', () => ({ db: { update: mockUpdate } }))
vi.mock('@sim/db/schema', () => ({
  webhook: {
    id: 'webhook.id',
    providerConfig: 'webhook.providerConfig',
    updatedAt: 'webhook.updatedAt',
  },
  account: {},
  credentialSet: {},
  workflow: {},
  workflowDeploymentVersion: {},
}))
vi.mock('drizzle-orm', () => ({
  sql: (strings: readonly string[], ...values: unknown[]) => {
    const node = { strings, values }
    sqlCalls.push(node)
    return node
  },
  and: vi.fn(),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  isNull: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
}))
vi.mock('@/lib/billing', () => ({ isOrganizationOnTeamOrEnterprisePlan: vi.fn() }))
vi.mock('@/app/api/auth/oauth/utils', () => ({
  getOAuthToken: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
}))
vi.mock('@/triggers/constants', () => ({ MAX_CONSECUTIVE_FAILURES: 5 }))

import { updateWebhookProviderConfig } from '@/lib/webhooks/polling/utils'

const logger = { error: vi.fn() } as never

function allInterpolatedValues(): unknown[] {
  return sqlCalls.flatMap((c) => c.values)
}

function allSqlText(): string {
  return sqlCalls.map((c) => c.strings.join('')).join(' ')
}

describe('updateWebhookProviderConfig (atomic jsonb merge)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sqlCalls.length = 0
    mockWhere.mockResolvedValue(undefined)
    mockSet.mockReturnValue({ where: mockWhere })
    mockUpdate.mockReturnValue({ set: mockSet })
  })

  it('merges defined keys (null preserved) and removes undefined keys', async () => {
    await updateWebhookProviderConfig(
      'wh-1',
      { historyId: 'h1', cleared: undefined, nulled: null },
      logger
    )

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(allInterpolatedValues()).toContain(JSON.stringify({ historyId: 'h1', nulled: null }))
    expect(allInterpolatedValues()).toContainEqual(['cleared'])
  })

  it('uses merge only (no key-removal expression) when nothing is undefined', async () => {
    await updateWebhookProviderConfig('wh-1', { historyId: 'h1' }, logger)

    expect(allInterpolatedValues()).toContain(JSON.stringify({ historyId: 'h1' }))
    expect(allInterpolatedValues().some((v) => Array.isArray(v))).toBe(false)
  })

  it('casts the json column to jsonb for the merge and back to json for storage', async () => {
    await updateWebhookProviderConfig('wh-1', { historyId: 'h1', cleared: undefined }, logger)

    const sqlText = allSqlText()
    // Column (interpolated as a value) is cast to jsonb: `COALESCE(<col>::jsonb, ...)`
    expect(sqlText).toContain('COALESCE(::jsonb')
    // Merge runs in jsonb space, result cast back to the json column: `(<expr>)::json`
    expect(sqlText).toContain(')::json')
  })
})
