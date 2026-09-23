/** @vitest-environment node */
import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  enterprise: vi.fn(),
  config: vi.fn(),
  test: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  enqueue: vi.fn(),
  outbound: vi.fn(),
  flags: { isBillingEnabled: true, isDataDrainsEnabled: true },
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mocks.audit,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))
vi.mock('@/lib/core/config/env-flags', () => ({
  ...mocks.flags,
  get isBillingEnabled() {
    return mocks.flags.isBillingEnabled
  },
  get isDataDrainsEnabled() {
    return mocks.flags.isDataDrainsEnabled
  },
  getEgressAllowedHosts: () => undefined,
  getEgressAllowedIpRanges: () => undefined,
  isHosted: true,
  isLegacyPrivateDatabaseAccessAllowed: () => false,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/data-drains/encryption', () => ({
  encryptCredentials: mocks.encrypt,
  decryptCredentials: mocks.decrypt,
}))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: async () => ({ enqueue: mocks.enqueue }) }))
vi.mock('@/lib/core/network/context.server', () => ({
  runWithOutboundOrganization: mocks.outbound,
}))
vi.mock('@/lib/data-drains/destinations/registry', () => ({
  getDestination: () => ({
    configSchema: z.record(z.string(), z.unknown()),
    credentialsSchema: z.record(z.string(), z.unknown()),
    test: mocks.test,
  }),
}))

import { dataDrainOperations } from '@/lib/data-drains/application/operations'
import {
  dataDrainToolPatchSchema,
  projectDataDrainForTool,
  projectDataDrainRunForTool,
} from '@/lib/data-drains/application/tool-projection'
import {
  authorizeDataDrainOperation,
  createDataDrain,
  deleteDataDrain,
  getDataDrain,
  listDataDrainRuns,
  listDataDrains,
  runDataDrain,
  testDataDrain,
  updateDataDrain,
} from '@/lib/data-drains/application/use-cases'

const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'chat' },
}
const row = {
  id: 'drain',
  organizationId: 'org',
  name: 'Exports',
  source: 'audit_logs' as const,
  destinationType: 'webhook' as const,
  destinationConfig: { url: 'https://example.com/secret?token=secret' },
  destinationCredentials: 'encrypted-secret',
  scheduleCadence: 'daily' as const,
  enabled: true,
  cursor: 'secret-cursor',
  createdBy: 'actor',
  lastRunAt: null,
  lastSuccessAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const input = { organizationId: 'org', drainId: 'drain' }
function allow(role = 'admin') {
  dbChainMockFns.limit.mockResolvedValueOnce([{ role }])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.enterprise.mockResolvedValue(true)
  mocks.config.mockResolvedValue(null)
  mocks.flags.isBillingEnabled = true
  mocks.flags.isDataDrainsEnabled = true
  mocks.decrypt.mockResolvedValue({ token: 'secret' })
  mocks.encrypt.mockResolvedValue('encrypted-secret')
  mocks.enqueue.mockResolvedValue('job')
  mocks.outbound.mockImplementation(async (_org: string, fn: () => Promise<unknown>) => fn())
})

describe('organization data drain application boundary', () => {
  it('declares immutable administrator policies with exact settings delegation', () => {
    expect(Object.isFrozen(dataDrainOperations)).toBe(true)
    for (const operation of Object.values(dataDrainOperations)) {
      expect(operation).toMatchObject({
        minimumRole: 'admin',
        principalKinds: ['session', 'organization_delegated'],
        delegationAudience: 'sim:settings',
        delegatedServices: ['copilot'],
      })
      expect(Object.isFrozen(operation)).toBe(true)
    }
  })
  it.each<Principal>([
    { kind: 'workspace_api_key', workspaceId: 'org', keyId: 'key' },
    { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
    { ...principal, organizationId: 'elsewhere' },
    { ...principal, audience: 'sim:knowledge' },
    { ...principal, expiresAt: new Date(0) },
    {
      ...principal,
      serviceId: 'slack-search',
      resourceScope: { installationId: 'install', eventId: 'event' },
    },
  ])('rejects unsupported or forged authority before protected loading', async (caller) => {
    await expect(getDataDrain.execute({ principal: caller, input })).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it.each(['owner', 'admin'])('allows %s reads using genuine session identity', async (role) => {
    allow(role)
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    const result = await getDataDrain.execute({
      principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
      input,
    })
    expect(result.id).toBe('drain')
    expect(result).not.toHaveProperty('destinationCredentials')
  })
  it.each(Object.values(dataDrainOperations))(
    'rejects members for $id including reads',
    async (operation) => {
      allow('member')
      await expect(authorizeDataDrainOperation(principal, operation, input)).rejects.toMatchObject({
        code: 'forbidden',
      })
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    }
  )
  it('preserves deployment gate precedence over role refusal', async () => {
    allow('member')
    mocks.flags.isBillingEnabled = false
    mocks.flags.isDataDrainsEnabled = false
    await expect(getDataDrain.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Data Drains are not enabled on this deployment',
    })
  })
  it('refuses non-enterprise cloud organizations before drain reads', async () => {
    allow()
    mocks.enterprise.mockResolvedValue(false)
    await expect(getDataDrain.execute({ principal, input })).rejects.toThrow('Enterprise')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })
  it('rechecks membership and propagates infrastructure errors', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(getDataDrain.execute({ principal, input })).rejects.toThrow('database unavailable')
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })
  it('conceals a drain outside the requested organization', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(getDataDrain.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
  it('bounds list expansion and strips credentials before the tool projection', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    const result = await listDataDrains.execute({
      principal,
      input: { organizationId: 'org', limit: 100 },
    })
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(100)
    expect(result[0]).not.toHaveProperty('destinationCredentials')
    expect(JSON.stringify(projectDataDrainForTool(result[0]))).not.toContain('secret')
  })
  it('preserves credentials when updating only safe settings and audits the actor', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...row, enabled: false }])
    await updateDataDrain.execute({ principal, input: { ...input, body: { enabled: false } } })
    expect(mocks.encrypt).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ enabled: false, updatedAt: expect.any(Date) })
    expect(mocks.audit).toHaveBeenCalledWith(
      dataDrainOperations.update,
      null,
      principal,
      undefined,
      expect.any(Array),
      'org'
    )
  })
  it('does not audit a failed or concurrently deleted update', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      updateDataDrain.execute({ principal, input: { ...input, body: { enabled: false } } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('does not audit a concurrent delete that affected no row', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(deleteDataDrain.execute({ principal, input })).resolves.toMatchObject({
      deleted: false,
    })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('requires creation credentials before persisting', async () => {
    allow()
    await expect(
      createDataDrain.execute({
        principal,
        input: {
          organizationId: 'org',
          body: {
            name: 'Export',
            source: 'audit_logs',
            scheduleCadence: 'daily',
            destinationType: 'webhook',
            destinationConfig: { url: 'https://example.com/webhook' },
          },
        },
      })
    ).rejects.toThrow('destinationCredentials is required')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('rejects runs for disabled drains without queueing or audit', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...row, enabled: false }])
    await expect(runDataDrain.execute({ principal, input })).rejects.toThrow('disabled')
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('queues manual exports using the existing concurrency key', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([])
    await expect(runDataDrain.execute({ principal, input })).resolves.toMatchObject({
      jobId: 'job',
    })
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'run-data-drain',
      { drainId: 'drain', trigger: 'manual' },
      { concurrencyKey: 'data-drain:drain' }
    )
  })
  it('tests using saved credentials under outbound organization policy and audits failure', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    mocks.test.mockRejectedValueOnce(new Error('provider secret'))
    await expect(testDataDrain.execute({ principal, input })).resolves.toMatchObject({ ok: false })
    expect(mocks.outbound).toHaveBeenCalledWith('org', expect.any(Function))
    expect(mocks.audit).toHaveBeenCalledWith(
      dataDrainOperations.test,
      null,
      principal,
      undefined,
      [expect.objectContaining({ metadata: expect.objectContaining({ outcome: 'failed' }) })],
      'org'
    )
  })
  it('bounds history and removes error, locator and cursor content from model output', async () => {
    allow()
    dbChainMockFns.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([])
    await listDataDrainRuns.execute({ principal, input: { ...input, limit: 25 } })
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(25)
    const safe = projectDataDrainRunForTool({
      id: 'run',
      drainId: 'drain',
      status: 'failed',
      trigger: 'manual',
      startedAt: new Date(),
      finishedAt: null,
      rowsExported: 2,
      bytesWritten: 3,
      cursorBefore: 'secret',
      cursorAfter: 'secret',
      locators: ['secret'],
      error: 'secret',
    })
    expect(JSON.stringify(safe)).not.toContain('secret')
  })
  it('tool patches reject destination or secret inputs rather than silently accepting them', () => {
    expect(dataDrainToolPatchSchema.safeParse({ enabled: false }).success).toBe(true)
    for (const field of [
      'destinationCredentials',
      'destinationConfig',
      'destinationType',
      'source',
    ])
      expect(dataDrainToolPatchSchema.safeParse({ [field]: 'secret' }).success).toBe(false)
  })
})
