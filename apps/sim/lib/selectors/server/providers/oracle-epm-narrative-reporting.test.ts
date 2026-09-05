/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), request: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({ createOracleEpmClient: mocks.client }))

import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleEpmNarrativeReportingSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-epm-narrative-reporting'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const args: ExecuteServerSelectorArgs = {
  selectorKey: 'oracle_epm_narrative_reporting.reports',
  context: { oauthCredential: 'browser-value' },
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  workspaceId: 'workspace',
  principal: { kind: 'session', userId: 'user', sessionId: 'session' },
  requesterUserId: 'user',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
  credential: {
    suppliedId: 'credential',
    providerId: 'oracle-epm-service-account',
    access: {
      isAuthorized: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'credential',
      credentialOwnerUserId: 'owner',
    },
  },
  signal: new AbortController().signal,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.bundle.mockResolvedValue({
    accessToken: 'server-token',
    instanceUrl: 'https://epm.example.com',
  })
  mocks.client.mockReturnValue({
    request: mocks.request,
    validateReturnedLink: vi.fn(),
    requestValidatedLink: vi.fn(),
  })
  mocks.request.mockResolvedValue({ status: 200, data: { items: [], hasMore: false } })
})
describe('Narrative selectors', () => {
  it.each([
    ['oracle_epm_narrative_reporting.reports', 'reportId', narrativeEndpoints.listReports],
    ['oracle_epm_narrative_reporting.books', 'bookId', narrativeEndpoints.listBooks],
    ['oracle_epm_narrative_reporting.artifacts', 'artifactId', narrativeEndpoints.listArtifacts],
  ] as const)(
    '%s uses its own native resource ID and projects only option metadata',
    async (selectorKey, idKey, endpoint) => {
      mocks.request.mockResolvedValue({
        status: 200,
        data: {
          items: [
            { [idKey]: 'native', name: 'Budget', links: [{ href: 'secret' }], token: 'secret' },
          ],
          hasMore: false,
        },
      })
      expect(await attachments[selectorKey].execute({ ...args, selectorKey })).toEqual({
        kind: 'list',
        items: [{ id: 'native', label: 'Budget' }],
      })
      expect(mocks.request).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({ signal: args.signal })
      )
      expect(mocks.client).toHaveBeenCalledWith({
        oauthCredential: 'credential',
        accessToken: 'server-token',
        instanceUrl: 'https://epm.example.com',
      })
    }
  )
  it('rejects provider mismatch before token resolution or provider access', async () => {
    await expect(
      attachments['oracle_epm_narrative_reporting.reports'].execute({
        ...args,
        credential: { ...args.credential!, providerId: 'netsuite-service-account' },
      })
    ).rejects.toThrow('Connection unavailable')
    expect(mocks.bundle).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('requires an authorized credential and a credential-bound environment', async () => {
    await expect(
      attachments['oracle_epm_narrative_reporting.reports'].execute({
        ...args,
        credential: undefined,
      })
    ).rejects.toThrow('Connection unavailable')
    mocks.bundle.mockResolvedValue({ accessToken: 'server-token' })
    await expect(
      attachments['oracle_epm_narrative_reporting.reports'].execute(args)
    ).rejects.toThrow('Connection unavailable')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('escapes a search value as one SCIM string and advances only one page', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { items: [{ reportId: 'r', name: 'Report' }], hasMore: true, offset: 50 },
    })
    const result = await attachments['oracle_epm_narrative_reporting.reports'].execute({
      ...args,
      request: { kind: 'list', search: 'a" or name pr', cursor: '50' },
    })
    expect(result).toMatchObject({ nextCursor: '51' })
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      narrativeEndpoints.listReports,
      expect.objectContaining({
        query: expect.objectContaining({
          q: `name co ${JSON.stringify('a" or name pr')}`,
          offset: 50,
          limit: 50,
        }),
      })
    )
  })
  it.each(['https://attacker.example', '-1', '5001', '1.5', '01'])(
    'rejects an invalid cursor %s before network work',
    async (cursor) => {
      await expect(
        attachments['oracle_epm_narrative_reporting.reports'].execute({
          ...args,
          request: { kind: 'list', cursor },
        })
      ).rejects.toThrow('Options unavailable')
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )
  it('reports truncation at the selector cap and rejects nonprogressing pages', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { items: [{ reportId: 'r', name: 'Report' }], hasMore: true, offset: 5000 },
    })
    const result = await attachments['oracle_epm_narrative_reporting.reports'].execute({
      ...args,
      request: { kind: 'list', cursor: '5000' },
    })
    expect(result).toMatchObject({ diagnostics: { truncated: { reason: 'provider-cap' } } })
    expect(result).not.toHaveProperty('nextCursor')
    mocks.request.mockResolvedValue({ status: 200, data: { items: [], hasMore: true } })
    await expect(
      attachments['oracle_epm_narrative_reporting.reports'].execute(args)
    ).rejects.toThrow('Options unavailable')
  })
  it('resolves a native detail ID without guessing repository compatibility', async () => {
    mocks.request.mockResolvedValue({ status: 200, data: { bookId: 'b', name: 'Book' } })
    expect(
      await attachments['oracle_epm_narrative_reporting.books'].execute({
        ...args,
        selectorKey: 'oracle_epm_narrative_reporting.books',
        request: { kind: 'detail', id: 'b' },
      })
    ).toEqual({ kind: 'detail', item: { id: 'b', label: 'Book' } })
    expect(mocks.request).toHaveBeenCalledWith(
      narrativeEndpoints.getBook,
      expect.objectContaining({ pathParams: { id: 'b' } })
    )
  })
  it('preserves aborts instead of converting them into safe provider errors', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      attachments['oracle_epm_narrative_reporting.reports'].execute({
        ...args,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.bundle).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
