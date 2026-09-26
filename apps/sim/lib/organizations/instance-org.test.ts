import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateOrganizationWithOwnerTx } = vi.hoisted(() => ({
  mockCreateOrganizationWithOwnerTx: vi.fn(),
}))

/**
 * Minimal chainable stub: each `select()` resolves to the next queued row set,
 * which is all these tests need to steer the slug lookup and membership check.
 */
const queuedRows: unknown[][] = []

function queueRows(rows: unknown[]): void {
  queuedRows.push(rows)
}

function buildSelectChain() {
  const chain: Record<string, unknown> = {}
  const step = () => chain
  for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy']) {
    chain[method] = vi.fn(step)
  }
  chain.limit = vi.fn(() => Promise.resolve(queuedRows.shift() ?? []))
  return chain
}

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwnerTx: mockCreateOrganizationWithOwnerTx,
  validateOrganizationSlugOrThrow: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

import {
  ensureInstanceOrganization,
  getInstanceOrganizationConfig,
  joinInstanceOrganization,
} from '@/lib/organizations/instance-org'

const { select: mockSelect, execute: mockExecute } = dbChainMockFns
const { mockEnsureUserInOrganization } = organizationMembershipMockFns

const ORIGINAL_ENV = { ...process.env }

function setInstanceEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('instance organization', () => {
  beforeEach(() => {
    queuedRows.length = 0
    setEnvFlags({ isBillingEnabled: false })
    mockSelect.mockImplementation(buildSelectChain)
    mockExecute.mockResolvedValue(undefined)
    setInstanceEnv({
      INSTANCE_ORG_NAME: 'Acme Inc',
      INSTANCE_ORG_SLUG: undefined,
      INSTANCE_ORG_OWNER_EMAIL: undefined,
    })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    resetEnvFlagsMock()
    resetDbChainMock()
  })

  describe('configuration', () => {
    it('stays off when billing is enabled, so paid orgs keep their own lifecycle', () => {
      setEnvFlags({ isBillingEnabled: true })
      expect(getInstanceOrganizationConfig()).toBeNull()
    })
  })

  describe('provisioning', () => {
    it('refuses when more than one organization shares the slug', async () => {
      /**
       * `organization.slug` has no unique constraint. Picking one of several
       * is unordered, so replicas could disagree and split signups across two
       * organizations — worse than declining until the operator disambiguates.
       */
      queueRows([{ id: 'org_a' }, { id: 'org_b' }]) // pre-transaction lookup
      queueRows([{ id: 'org_a' }, { id: 'org_b' }]) // re-check under the lock

      const result = await ensureInstanceOrganization('user-1')

      expect(result).toBeNull()
      /** Must not add a third row to a set the operator already has to untangle. */
      expect(mockCreateOrganizationWithOwnerTx).not.toHaveBeenCalled()
    })

    it('adopts the organization a racing replica created under the lock', async () => {
      queueRows([]) // first lookup misses
      queueRows([{ id: 'org_raced' }]) // re-check under the lock finds it

      const result = await ensureInstanceOrganization('user-1')

      expect(result).toBe('org_raced')
      expect(mockCreateOrganizationWithOwnerTx).not.toHaveBeenCalled()
    })

    it('refuses when the prospective owner already belongs to another organization', async () => {
      queueRows([])
      queueRows([])
      queueRows([{ organizationId: 'org_other' }])

      const result = await ensureInstanceOrganization('user-1')

      expect(result).toBeNull()
      expect(mockCreateOrganizationWithOwnerTx).not.toHaveBeenCalled()
    })
  })

  describe('joining', () => {
    it('never throws, so a failure cannot block signup', async () => {
      queueRows([{ id: 'org_existing' }])
      mockEnsureUserInOrganization.mockRejectedValue(new Error('database unavailable'))

      await expect(joinInstanceOrganization('user-2')).resolves.toBeUndefined()
    })
  })
})
