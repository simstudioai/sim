/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateOrganizationWithOwnerTx, mockEnsureUserInOrganization, mockSelect, mockExecute } =
  vi.hoisted(() => ({
    mockCreateOrganizationWithOwnerTx: vi.fn(),
    mockEnsureUserInOrganization: vi.fn(),
    mockSelect: vi.fn(),
    mockExecute: vi.fn(),
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

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    execute: mockExecute,
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ select: mockSelect, execute: mockExecute })
    ),
  },
}))

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwnerTx: mockCreateOrganizationWithOwnerTx,
  validateOrganizationSlugOrThrow: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganization: mockEnsureUserInOrganization,
}))

import {
  ensureInstanceOrganization,
  getInstanceOrganizationConfig,
  isInstanceOrganizationMode,
  joinInstanceOrganization,
} from '@/lib/organizations/instance-org'

const ORIGINAL_ENV = { ...process.env }

function setInstanceEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('instance organization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  afterAll(resetEnvFlagsMock)

  describe('configuration', () => {
    it('is off when INSTANCE_ORG_NAME is unset', () => {
      setInstanceEnv({ INSTANCE_ORG_NAME: undefined })
      expect(getInstanceOrganizationConfig()).toBeNull()
      expect(isInstanceOrganizationMode()).toBe(false)
    })

    it('derives a slug from the name', () => {
      expect(getInstanceOrganizationConfig()).toMatchObject({
        name: 'Acme Inc',
        slug: 'acme-inc',
      })
    })

    it('prefers an explicit slug', () => {
      setInstanceEnv({ INSTANCE_ORG_SLUG: 'custom-slug' })
      expect(getInstanceOrganizationConfig()?.slug).toBe('custom-slug')
    })

    it('stays off when billing is enabled, so paid orgs keep their own lifecycle', () => {
      setEnvFlags({ isBillingEnabled: true })
      expect(getInstanceOrganizationConfig()).toBeNull()
    })
  })

  describe('provisioning', () => {
    it('creates the organization when none exists', async () => {
      queueRows([]) // getInstanceOrganizationId lookup
      queueRows([]) // post-lock re-check
      queueRows([]) // owner membership check
      mockCreateOrganizationWithOwnerTx.mockResolvedValue({ organizationId: 'org_new' })

      const result = await ensureInstanceOrganization('user-1')

      expect(result).toBe('org_new')
      /**
       * The transaction is passed through so the advisory lock taken above
       * still covers the insert.
       */
      expect(mockCreateOrganizationWithOwnerTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ownerUserId: 'user-1', name: 'Acme Inc', slug: 'acme-inc' })
      )
    })

    it('reuses the existing organization without creating a second one', async () => {
      queueRows([{ id: 'org_existing' }])

      const result = await ensureInstanceOrganization('user-1')

      expect(result).toBe('org_existing')
      expect(mockCreateOrganizationWithOwnerTx).not.toHaveBeenCalled()
    })

    it('takes the advisory lock before creating', async () => {
      queueRows([])
      queueRows([])
      queueRows([])
      mockCreateOrganizationWithOwnerTx.mockResolvedValue({ organizationId: 'org_new' })

      await ensureInstanceOrganization('user-1')

      const executed = mockExecute.mock.calls.map(([arg]) => JSON.stringify(arg))
      expect(executed.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true)
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

    it('re-reads the organization on every call instead of caching the id', async () => {
      /**
       * A per-process cache goes stale when the organization is deleted through
       * the Admin API, and clearing it from the delete handler would only heal
       * the replica that served that request. Re-reading keeps every replica
       * self-correcting.
       */
      queueRows([{ id: 'org_existing' }])
      await ensureInstanceOrganization('user-1')
      const callsAfterFirst = mockSelect.mock.calls.length

      queueRows([])
      queueRows([])
      queueRows([])
      mockCreateOrganizationWithOwnerTx.mockResolvedValue({ organizationId: 'org_recreated' })
      const recreated = await ensureInstanceOrganization('user-2')

      expect(mockSelect.mock.calls.length).toBeGreaterThan(callsAfterFirst)
      expect(recreated).toBe('org_recreated')
    })
  })

  describe('joining', () => {
    it('adds the user as a member', async () => {
      queueRows([{ id: 'org_existing' }])
      mockEnsureUserInOrganization.mockResolvedValue({ success: true, alreadyMember: false })

      await joinInstanceOrganization('user-2')

      expect(mockEnsureUserInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          organizationId: 'org_existing',
          role: 'member',
          skipBillingLogic: true,
          skipSeatValidation: true,
        })
      )
    })

    it('does nothing when the mode is off', async () => {
      setInstanceEnv({ INSTANCE_ORG_NAME: undefined })

      await joinInstanceOrganization('user-2')

      expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    })

    it('never throws, so a failure cannot block signup', async () => {
      queueRows([{ id: 'org_existing' }])
      mockEnsureUserInOrganization.mockRejectedValue(new Error('database unavailable'))

      await expect(joinInstanceOrganization('user-2')).resolves.toBeUndefined()
    })
  })
})
