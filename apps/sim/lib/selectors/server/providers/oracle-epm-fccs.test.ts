/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applications: vi.fn(),
  cubes: vi.fn(),
  dimensions: vi.fn(),
  hierarchy: vi.fn(),
  jobs: vi.fn(),
  files: vi.fn(),
  resolve: vi.fn(),
  bundle: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm-fccs/operations', () => ({
  executeFccsListApplicationsOperation: mocks.applications,
  executeFccsListCubesOperation: mocks.cubes,
  executeFccsListDimensionsOperation: mocks.dimensions,
  executeFccsGetDimensionOperation: mocks.hierarchy,
  executeFccsListJobDefinitionsOperation: mocks.jobs,
  executeFccsListFilesOperation: mocks.files,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.resolve }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/blocks', () => ({ getBlock: vi.fn() }))

import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
  projectSelectorContext,
} from '@/lib/selectors/context'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import {
  flattenFccsMembers,
  oracleEpmFccsSelectorAttachments,
} from '@/lib/selectors/server/providers/oracle-epm-fccs'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OracleEpmFccsBlock } from '@/blocks/blocks/oracle_epm_fccs'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: 'server-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
const base: ExecuteServerSelectorArgs = {
  selectorKey: 'oracleEpmFccs.applications',
  context: {},
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  requesterUserId: 'user-1',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
}
const attachment = oracleEpmFccsSelectorAttachments['oracleEpmFccs.applications']
function execute(
  key: keyof typeof oracleEpmFccsSelectorAttachments,
  context: ExecuteServerSelectorArgs['context'] = {},
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' }
) {
  return attachment.execute({ ...base, selectorKey: key, context, request }, auth)
}
const ok = (items: unknown[], extra: object = {}) => ({
  success: true,
  output: { items, ...extra },
})
describe('FCCS server selectors', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolve.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue(auth)
  })
  it('binds destination and token to the authorized Oracle service-account credential', async () => {
    const args = {
      ...base,
      credential: {
        suppliedId: 'credential-1',
        access: {
          resolvedCredentialId: 'credential-1',
          credentialType: 'service_account',
          credentialOwnerUserId: 'user-1',
        },
      },
    } as ExecuteServerSelectorArgs
    expect(await attachment.destination.prepare(args)).toEqual(auth)
    expect(mocks.resolve).toHaveBeenCalledWith('credential-1')
    mocks.resolve.mockResolvedValue({ credentialType: 'service_account', providerId: 'netsuite' })
    await expect(attachment.destination.prepare(args)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    expect(mocks.bundle).toHaveBeenCalledTimes(1)
  })
  it('rejects missing credentials and untrusted destinations without invoking a listing operation', async () => {
    await expect(attachment.destination.prepare(base)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    const args = {
      ...base,
      credential: {
        suppliedId: 'id',
        access: { resolvedCredentialId: 'id', credentialType: 'service_account' },
      },
    } as ExecuteServerSelectorArgs
    mocks.bundle.mockResolvedValue({ ...auth, instanceUrl: 'http://epm.example.com' })
    await expect(attachment.destination.prepare(args)).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    expect(mocks.applications).not.toHaveBeenCalled()
  })
  it('projects application/cube/file options from server operation results only', async () => {
    mocks.applications.mockResolvedValue(ok([{ name: 'Close', appType: 'FCCS', secret: 'canary' }]))
    expect(await execute('oracleEpmFccs.applications')).toMatchObject({
      items: [{ id: 'Close', label: 'Close', meta: { appType: 'FCCS' } }],
    })
    mocks.cubes.mockResolvedValue(ok([{ planTypeName: 'Consol', cubeName: 'Consolidation' }]))
    expect(await execute('oracleEpmFccs.cubes', { database: 'Close' })).toMatchObject({
      items: [{ id: 'Consol', label: 'Consolidation' }],
    })
    expect(mocks.cubes).toHaveBeenCalledWith({ ...auth, application: 'Close' }, undefined)
    mocks.files.mockResolvedValue(ok([{ name: 'inbox/report.csv', size: '3' }]))
    expect(await execute('oracleEpmFccs.files')).toMatchObject({
      items: [{ id: 'inbox/report.csv', label: 'inbox/report.csv', meta: { sizeBytes: '3' } }],
    })
  })
  it('requires selector dependencies before making a provider request', async () => {
    await expect(
      execute('oracleEpmFccs.members', { database: 'Close', planId: 'Consol' })
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(execute('oracleEpmFccs.cubes')).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    expect(mocks.hierarchy).not.toHaveBeenCalled()
    expect(mocks.cubes).not.toHaveBeenCalled()
  })
  it('rejects incomplete dimension pages without accumulating or silently truncating', async () => {
    mocks.dimensions.mockResolvedValue(
      ok([{ name: 'Entity', dimType: 'Entity' }], { hasMore: true, totalResults: 1001 })
    )
    await expect(
      execute('oracleEpmFccs.dimensions', { database: 'Close', planId: 'Consol' })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    expect(mocks.dimensions).toHaveBeenCalledTimes(1)
    expect(mocks.dimensions).toHaveBeenCalledWith(
      { ...auth, application: 'Close', cube: 'Consol', limit: 1000 },
      undefined
    )
  })
  it.each([
    ['periods', 'Period'],
    ['entities', 'Entity'],
    ['scenarios', 'Scenario'],
  ] as const)('discovers the tenant %s dimension by documented type', async (key, dimType) => {
    mocks.dimensions.mockResolvedValue(
      ok([{ name: 'Tenant Dimension', dimType }], { hasMore: false })
    )
    mocks.hierarchy.mockResolvedValue({
      success: true,
      output: { name: 'Tenant Dimension', children: [{ name: 'Selected', alias: 'Alias' }] },
    })
    expect(
      await execute(`oracleEpmFccs.${key}`, { database: 'Close', planId: 'Consol' })
    ).toMatchObject({
      items: expect.arrayContaining([{ id: 'Selected', label: 'Selected (Alias)' }]),
    })
    expect(mocks.dimensions).toHaveBeenCalledWith(
      { ...auth, application: 'Close', cube: 'Consol', limit: 1000, filter: { dimType } },
      undefined
    )
    expect(mocks.hierarchy).toHaveBeenCalledWith(
      { ...auth, application: 'Close', cube: 'Consol', dimension: 'Tenant Dimension' },
      undefined
    )
  })
  it('bounds, flattens, deduplicates and searches hierarchy labels without inventing members', async () => {
    const hierarchy = {
      name: 'Entity',
      children: [
        { name: 'North', alias: 'NORTHWEST', path: '/Entity/North' },
        { name: 'Shared', children: [{ name: 'North' }] },
      ],
    }
    expect(flattenFccsMembers(hierarchy)).toHaveLength(3)
    mocks.hierarchy.mockResolvedValue({ success: true, output: hierarchy })
    const context = { database: 'Close', planId: 'Consol', objectType: 'Entity' }
    expect(
      await execute('oracleEpmFccs.members', context, { kind: 'list', search: 'west' })
    ).toMatchObject({
      items: [{ id: 'North', label: 'North (NORTHWEST)', meta: { path: '/Entity/North' } }],
    })
    expect(
      await execute('oracleEpmFccs.members', context, { kind: 'detail', id: 'missing' })
    ).toMatchObject({ item: null })
    mocks.hierarchy.mockResolvedValue({
      success: true,
      output: {
        name: 'Entity',
        children: Array.from({ length: 10000 }, (_, i) => ({ name: String(i) })),
      },
    })
    await expect(execute('oracleEpmFccs.members', context)).rejects.toBeInstanceOf(
      SelectorOptionsUnavailableError
    )
  })
  it.each([
    ['rules', 'RULES'],
    ['ruleSets', 'RULESET'],
    ['jobDefinitions', 'IMPORT_DATA'],
  ] as const)(
    'lists %s via configured job definitions and filters unsupported families',
    async (key, jobType) => {
      mocks.jobs.mockResolvedValue(
        ok([
          { jobType, jobName: 'Tenant job' },
          { jobType: 'DELETE_APPLICATION', jobName: 'not allowed' },
        ])
      )
      expect(
        await execute(`oracleEpmFccs.${key}`, { database: 'Close', objectType: jobType })
      ).toMatchObject({ items: [{ id: 'Tenant job', label: 'Tenant job', meta: { jobType } }] })
      expect(mocks.jobs).toHaveBeenCalledWith({ ...auth, application: 'Close', jobType }, undefined)
    }
  )
  it('derives configured-job filters from the active operation and rejects arbitrary job families', async () => {
    mocks.jobs.mockResolvedValue(ok([]))
    await execute('oracleEpmFccs.jobDefinitions', {
      database: 'Close',
      environmentType: 'oracle_epm_fccs_export_metadata',
      objectType: 'RULES',
    })
    expect(mocks.jobs).toHaveBeenCalledWith(
      { ...auth, application: 'Close', jobType: 'EXPORT_METADATA' },
      undefined
    )
    await expect(
      execute('oracleEpmFccs.jobDefinitions', {
        database: 'Close',
        objectType: 'DELETE_APPLICATION',
      })
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
  })
  it('does not leak provider failures and honors cancellation', async () => {
    mocks.applications.mockRejectedValue(new Error('provider-secret-canary'))
    await expect(execute('oracleEpmFccs.applications')).rejects.toEqual(
      new SelectorOptionsUnavailableError()
    )
    const signal = AbortSignal.abort(new DOMException('stopped', 'AbortError'))
    await expect(attachment.execute({ ...base, signal }, auth)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
  it('projects only approved aliases and resolves manual canonical dependencies', () => {
    expect(
      projectSelectorContext('oracleEpmFccs.members', {
        oauthCredential: 'id',
        application: 'Close',
        cube: 'Consol',
        dimension: 'Entity',
        accessToken: 'hidden',
        instanceUrl: 'hidden',
      })
    ).toEqual({ oauthCredential: 'id', database: 'Close', planId: 'Consol', objectType: 'Entity' })
    const values = {
      operation: 'oracle_epm_fccs_get_member',
      credential: 'id',
      applicationSelector: 'stale',
      applicationManual: 'Manual Close',
      cubeSelector: 'Consol',
      dimensionSelector: 'Entity',
    }
    const configs = getSelectorContextSubBlocks(OracleEpmFccsBlock.subBlocks, values)
    const projected = buildSelectorContextFromValues({
      selectorKey: 'oracleEpmFccs.members',
      contextConfigs: configs,
      values,
      dependsOn: ['oauthCredential', 'application', 'cube', 'dimension'],
      canonicalModes: { application: 'advanced' },
    })
    expect(projected.database).toBe('Manual Close')
    expect(projected.planId).toBe('Consol')
    expect(projected.objectType).toBe('Entity')
    expect(
      projectSelectorContext('oracleEpmFccs.cubes', {
        oauthCredential: 'id',
        application: '<previous.application>',
      })
    ).toEqual({ oauthCredential: 'id' })
  })
})
