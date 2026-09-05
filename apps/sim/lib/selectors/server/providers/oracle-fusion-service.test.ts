/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion-service/operations', () => ({
  listOracleFusionServiceResource: mocks.list,
  getOracleFusionServiceResource: mocks.get,
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionServiceSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-service'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const AUTH = {
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
  accessToken: Buffer.from('user:password').toString('base64'),
}
const args: ExecuteServerSelectorArgs = {
  selectorKey: 'oracleFusionService.serviceRequests',
  context: {},
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  workspaceId: 'workspace',
  principal: { kind: 'session', userId: 'user', sessionId: 'session' },
  requesterUserId: 'user',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
}
function execute(input: Partial<ExecuteServerSelectorArgs> = {}) {
  const request = { ...args, ...input }
  const key = request.selectorKey as keyof typeof oracleFusionServiceSelectorAttachments
  return oracleFusionServiceSelectorAttachments[key].execute(request, AUTH)
}

beforeEach(() => vi.clearAllMocks())

describe('Fusion Service selectors', () => {
  it('preserves request numbers and advances only using the returned next offset', async () => {
    mocks.list.mockResolvedValue({
      items: [{ SrNumber: 'SR 42', Title: 'Customer help' }],
      hasMore: true,
      nextOffset: 51,
    })
    expect(await execute({ request: { kind: 'list', cursor: '50' } })).toEqual({
      kind: 'list',
      items: [{ id: 'SR 42', label: 'SR 42 — Customer help' }],
      nextCursor: '51',
    })
    expect(mocks.list).toHaveBeenCalledWith(
      'request',
      {
        ...AUTH,
        offset: 50,
        limit: 50,
        totalResults: false,
      },
      undefined
    )
  })

  it.each([
    ['oracleFusionService.accounts', 'accounts'],
    ['oracleFusionService.contacts', 'contacts'],
    ['oracleFusionService.resources', 'resources'],
  ] as const)(
    'resolves %s assignment IDs by PartyId, never by the PartyNumber route',
    async (key, resource) => {
      mocks.list.mockResolvedValue({
        items: [{ PartyId: '999999999999999999', PartyNumber: 'PARTY42' }],
        hasMore: false,
      })
      const result = await execute({
        selectorKey: key,
        request: { kind: 'detail', id: '999999999999999999' },
      })
      expect(result).toMatchObject({ kind: 'detail', item: { id: '999999999999999999' } })
      expect(mocks.list).toHaveBeenCalledWith(
        resource,
        {
          ...AUTH,
          q: 'PartyId=999999999999999999',
          limit: 2,
          offset: 0,
        },
        undefined
      )
      expect(mocks.get).not.toHaveBeenCalled()
    }
  )

  it('rejects an ambiguous or mismatched PartyId lookup', async () => {
    mocks.list.mockResolvedValue({ items: [{ PartyId: '43' }], hasMore: false })
    await expect(
      execute({
        selectorKey: 'oracleFusionService.contacts',
        request: { kind: 'detail', id: '42' },
      })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
    mocks.list.mockResolvedValue({ items: [{ PartyId: '42' }, { PartyId: '42' }], hasMore: false })
    await expect(
      execute({
        selectorKey: 'oracleFusionService.contacts',
        request: { kind: 'detail', id: '42' },
      })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })

  it('returns tenant status codes and does not invent a composite-key detail route', async () => {
    mocks.list.mockResolvedValue({
      items: [{ LookupCode: 'CUSTOM_DONE', Meaning: 'Completed' }],
      hasMore: false,
    })
    expect(await execute({ selectorKey: 'oracleFusionService.statuses' })).toEqual({
      kind: 'list',
      items: [{ id: 'CUSTOM_DONE', label: 'Completed — CUSTOM_DONE' }],
    })
    await expect(
      execute({
        selectorKey: 'oracleFusionService.statuses',
        request: { kind: 'detail', id: 'CUSTOM_DONE' },
      })
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
  })

  it('rejects malformed cursors before calling Oracle', async () => {
    await expect(execute({ request: { kind: 'list', cursor: '1e3' } })).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('distinguishes missing records from authentication failures', async () => {
    mocks.get.mockRejectedValueOnce(new OracleFusionProviderError('Not found', 404))
    expect(await execute({ request: { kind: 'detail', id: 'SR1' } })).toEqual({
      kind: 'detail',
      item: null,
    })
    mocks.get.mockRejectedValueOnce(new OracleFusionProviderError('Unauthorized', 401))
    await expect(execute({ request: { kind: 'detail', id: 'SR1' } })).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
  })

  it('requires a bound Fusion service account before resolving secrets or fetching', async () => {
    await expect(
      oracleFusionServiceSelectorAttachments['oracleFusionService.serviceRequests'].execute(args)
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.bundle).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
