/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), resolve: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
}))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({
  createOracleEpmClient: () => ({
    request: mocks.request,
    validateReturnedLink: vi.fn(),
    requestValidatedLink: vi.fn(),
  }),
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.resolve }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import { projectSelectorContext } from '@/lib/selectors/context'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmPlanningSelectorAttachments } from '@/lib/selectors/server/providers/oracle-epm-planning'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

type Key = keyof typeof oracleEpmPlanningSelectorAttachments
const auth = {
  oauthCredential: 'credential-1',
  accessToken: 'server-only-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
function args(key: Key): ExecuteServerSelectorArgs {
  return {
    selectorKey: key,
    context: {
      oauthCredential: 'credential-1',
      projectId: 'Vision',
      planId: 'Plan1',
      objectType: 'RULES',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'credential-1',
      access: { ok: true, resolvedCredentialId: 'credential-1', credentialType: 'service_account' },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}
function execute(key: Key, overrides: Partial<ExecuteServerSelectorArgs> = {}) {
  return oracleEpmPlanningSelectorAttachments[key].execute({ ...args(key), ...overrides }, auth)
}
describe('Planning selectors (NetSuite binding and Snowflake bounded discovery precedents)', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.resolve.mockReset()
    mocks.bundle.mockReset()
    mocks.resolve.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-epm-service-account',
    })
    mocks.bundle.mockResolvedValue(auth)
  })
  it('binds the existing Oracle EPM service-account provider and gateway URL', async () => {
    mocks.request.mockResolvedValue({ status: 200, data: { items: [{ name: 'Vision' }] } })
    const result = await oracleEpmPlanningSelectorAttachments[
      'oracleEpmPlanning.applications'
    ].execute(args('oracleEpmPlanning.applications'))
    expect(result).toEqual({ kind: 'list', items: [{ id: 'Vision', label: 'Vision' }] })
    expect(mocks.resolve).toHaveBeenCalledWith('credential-1')
    expect(JSON.stringify(result)).not.toContain(auth.accessToken)
  })
  it('rejects a different provider before listing', async () => {
    mocks.resolve.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'netsuite-service-account',
    })
    await expect(
      oracleEpmPlanningSelectorAttachments['oracleEpmPlanning.applications'].execute(
        args('oracleEpmPlanning.applications')
      )
    ).rejects.toThrow('Connection unavailable')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('uses cube names, not numeric plan type IDs', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: {
        items: [
          {
            planTypeName: 'Plan1',
            planType: 1,
            cubeName: 'EssbaseName',
            numDimensions: 12,
            cubeType: 0,
          },
        ],
      },
    })
    expect(await execute('oracleEpmPlanning.cubes')).toEqual({
      kind: 'list',
      items: [{ id: 'Plan1', label: 'Plan1' }],
    })
  })
  it('reuses listing operations and advances dimension offsets until complete', async () => {
    mocks.request
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [{ name: 'Account' }], totalResults: 2, hasMore: true },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [{ name: 'Entity' }], totalResults: 2, hasMore: false },
      })
    expect(await execute('oracleEpmPlanning.dimensions')).toEqual({
      kind: 'list',
      items: [
        { id: 'Account', label: 'Account' },
        { id: 'Entity', label: 'Entity' },
      ],
    })
    expect(mocks.request.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      planningEndpoints.dimensions,
      planningEndpoints.dimensions,
    ])
    expect(mocks.request.mock.calls.map(([, input]) => input.query.offset)).toEqual([0, 1])
  })
  it.each([
    { items: [], totalResults: 1, hasMore: true },
    { items: [{ name: 'Account' }], totalResults: 2, hasMore: false },
    {
      items: Array.from({ length: 1001 }, (_, i) => ({ name: 'D' + i })),
      totalResults: 1001,
      hasMore: false,
    },
  ])('never presents an incomplete or over-cap listing as complete', async (data) => {
    mocks.request.mockResolvedValue({ status: 200, data })
    await expect(execute('oracleEpmPlanning.dimensions')).rejects.toThrow('Options unavailable')
  })
  it('bounds pages even when Oracle keeps advertising a next page', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { items: [{ name: 'Account' }], totalResults: 50, hasMore: true },
    })
    await expect(execute('oracleEpmPlanning.dimensions')).rejects.toThrow('Options unavailable')
    expect(mocks.request).toHaveBeenCalledTimes(20)
  })
  it('accounts for response bytes before discarding unknown provider fields', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: {
        items: [{ name: 'Account' }],
        totalResults: 3,
        hasMore: true,
        padding: 'x'.repeat(8 * 1024 * 1024),
      },
    })
    await expect(execute('oracleEpmPlanning.dimensions')).rejects.toThrow('Options unavailable')
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['oracleEpmPlanning.rules', 'RULES'],
    ['oracleEpmPlanning.rulesets', 'RULESET'],
  ] as const)('filters %s using its fixed job type', async (key, jobType) => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: {
        items: [
          { jobName: 'Correct', jobType },
          { jobName: 'Wrong', jobType: 'IMPORT_DATA' },
        ],
      },
    })
    expect(await execute(key)).toEqual({
      kind: 'list',
      items: [{ id: 'Correct', label: 'Correct', meta: { detail: jobType } }],
    })
    expect(mocks.request.mock.calls[0][1].query.q).toBe(JSON.stringify({ jobType }))
  })
  it('requires dependencies and propagates cancellation before fetching', async () => {
    await expect(
      execute('oracleEpmPlanning.dimensions', { context: { projectId: 'Vision' } })
    ).rejects.toThrow('Context unavailable')
    const controller = new AbortController()
    controller.abort(new DOMException('Stopped', 'AbortError'))
    await expect(
      execute('oracleEpmPlanning.cubes', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('does not convert permission failures into empty lists', async () => {
    mocks.request.mockRejectedValue(oracleEpmLocalError('forbidden'))
    await expect(execute('oracleEpmPlanning.applications')).rejects.toThrow('Options unavailable')
  })
  it('projects existing context slots without credential material or inactive fields', () => {
    expect(
      projectSelectorContext('oracleEpmPlanning.dimensions', {
        application: 'Vision',
        cube: 'Plan1',
        oauthCredential: 'credential-1',
        accessToken: 'secret',
        memberName: 'Inactive',
      })
    ).toEqual({ oauthCredential: 'credential-1', projectId: 'Vision', planId: 'Plan1' })
  })
  it('returns null detail for an undiscovered manual identifier', async () => {
    mocks.request.mockResolvedValue({ status: 200, data: { items: [] } })
    expect(
      await execute('oracleEpmPlanning.applications', {
        request: { kind: 'detail', id: 'ManuallyConfigured' },
      })
    ).toEqual({ kind: 'detail', item: null })
  })
})
