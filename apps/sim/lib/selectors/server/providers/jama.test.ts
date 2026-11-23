import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import {
  selectorCredentialBundleMock,
  selectorCredentialBundleMockFns,
} from '@sim/testing/mocks/selector-credential-bundle.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => selectorCredentialBundleMock)

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { jamaSelectorAttachments } from '@/lib/selectors/server/providers/jama'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const fetchProvider = inputValidationMockFns.mockSecureFetchWithValidation
const resolveCredential = selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle

function args(request: ExecuteServerSelectorArgs['request']): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'jama.projects',
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: createSessionPrincipal(),
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

function page(startIndex: number, totalResults: number, data: unknown[]) {
  return Response.json({
    data,
    meta: { pageInfo: { startIndex, totalResults, resultCount: data.length } },
  })
}

describe('Jama selector pagination and credential binding', () => {
  beforeEach(() => {
    resolveCredential.mockResolvedValue({
      accessToken: 'private-token',
      instanceUrl: 'https://tenant.example.com/jama',
    })
  })

  it('advances by the returned count and omits private provider fields', async () => {
    fetchProvider.mockResolvedValueOnce(
      page(50, 53, [
        { id: 71, name: 'Requirements', privateToken: 'provider-private' },
        { id: 72, fields: { name: 'Verification' } },
      ])
    )
    const result = await jamaSelectorAttachments['jama.projects'].execute(
      args({ kind: 'list', cursor: '50' })
    )
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: '71', label: 'Requirements' },
        { id: '72', label: 'Verification' },
      ],
      nextCursor: '52',
    })
  })

  it.each(['-1', '2.5', 'https://attacker.invalid', '9007199254740992'])(
    'rejects an invalid pagination cursor %s',
    async (cursor) => {
      await expect(
        jamaSelectorAttachments['jama.projects'].execute(args({ kind: 'list', cursor }))
      ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    }
  )

  it('stops on an empty page and rejects provider pagination that would loop', async () => {
    fetchProvider.mockResolvedValueOnce(page(50, 70, []))
    expect(
      await jamaSelectorAttachments['jama.projects'].execute(args({ kind: 'list', cursor: '50' }))
    ).toEqual({ kind: 'list', items: [] })
    fetchProvider.mockResolvedValueOnce(page(0, 70, [{ id: 1, name: 'Wrong page' }]))
    await expect(
      jamaSelectorAttachments['jama.projects'].execute(args({ kind: 'list', cursor: '50' }))
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })

  it('does not substitute user context when the credential has no instance', async () => {
    resolveCredential.mockResolvedValueOnce({ accessToken: 'private-token' })
    await expect(
      jamaSelectorAttachments['jama.projects'].execute(args({ kind: 'list' }))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
  })

  it('rejects a parent project that could change the provider path', async () => {
    const input = args({ kind: 'list' })
    input.selectorKey = 'jama.itemTypes'
    input.context.projectId = '../users'
    await expect(jamaSelectorAttachments['jama.itemTypes'].execute(input)).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
  })
})
