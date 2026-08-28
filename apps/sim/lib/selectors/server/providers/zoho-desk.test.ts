/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveSelectorCredentialBundle, mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockResolveSelectorCredentialBundle: vi.fn(),
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetchWithValidation,
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveSelectorCredentialBundle,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { zohoDeskSelectorAttachments } from '@/lib/selectors/server/providers/zoho-desk'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function organizationArgs(signal: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'zoho_desk.organizations',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

describe('Zoho Desk server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      apiDomain: 'https://desk.zoho.com',
    })
  })

  it('preserves caller cancellation from the provider boundary', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort()
    mockSecureFetchWithValidation.mockRejectedValueOnce(abortError)

    await expect(
      zohoDeskSelectorAttachments['zoho_desk.organizations'].execute(
        organizationArgs(controller.signal)
      )
    ).rejects.toBe(abortError)
  })
})
