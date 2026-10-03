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

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { zohoDeskSelectorAttachments } from '@/lib/selectors/server/providers/zoho-desk'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mockResolveSelectorCredentialBundle =
  selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle

const mockSecureFetchWithValidation = inputValidationMockFns.mockSecureFetchWithValidation

function organizationArgs(signal: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'zoho_desk.organizations',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: createSessionPrincipal(),
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

describe('Zoho Desk server selector adapters', () => {
  beforeEach(() => {
    mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      apiDomain: 'https://desk.zoho.com',
    })
  })

  it('conceals and cancels a rejected provider response while preserving its safe category', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('provider-controlled-secret'))
      },
      cancel,
    })
    mockSecureFetchWithValidation.mockResolvedValueOnce(new Response(body, { status: 401 }))

    await expect(
      zohoDeskSelectorAttachments['zoho_desk.organizations'].execute(
        organizationArgs(new AbortController().signal)
      )
    ).rejects.toEqual(new SelectorConnectionUnavailableError(401))
    expect(cancel).toHaveBeenCalledOnce()
    expect(mockSecureFetchWithValidation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        profile: 'configuredEndpoint',
        logUrlValidationDetails: false,
      })
    )
  })
})
