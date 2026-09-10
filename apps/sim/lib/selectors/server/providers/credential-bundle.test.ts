/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResolveCredentialAccessToken = vi.hoisted(() => vi.fn())
const mockResolveOrganizationToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/credentials/application/organization-credentials', () => ({
  resolveOrganizationCredentialTokenBundle: mockResolveOrganizationToken,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialTokenBundle: mockResolveCredentialAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'

describe('selector credential bundles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('protects short credential-bound cloud ids as exact identifiers', async () => {
    mockResolveCredentialAccessToken.mockResolvedValue({
      accessToken: 'server-only-token',
      cloudId: 'cloud-1',
      domain: 'acme.atlassian.net',
    })
    const protectedValues = createSelectorProtectedValues()

    await expect(
      resolveSelectorCredentialBundle({
        credential: {
          suppliedId: 'credential-1',
          access: { ok: true, credentialOwnerUserId: 'owner-1' },
        },
        protectedValues,
      })
    ).resolves.toMatchObject({ cloudId: 'cloud-1' })

    expect(protectedValues.contains('cloud-1')).toBe(true)
    expect(protectedValues.contains('prefix-cloud-1-suffix')).toBe(false)
  })

  it('preserves a selector abort without canceling the shared resolution', async () => {
    let resolveShared!: (value: { accessToken: string }) => void
    const sharedResolution = new Promise<{ accessToken: string }>((resolve) => {
      resolveShared = resolve
    })
    mockResolveCredentialAccessToken.mockReturnValue(sharedResolution)
    const controller = new AbortController()
    const protectedValues = createSelectorProtectedValues()
    const pending = resolveSelectorCredentialBundle({
      credential: {
        suppliedId: 'credential-1',
        access: { ok: true, credentialOwnerUserId: 'owner-1' },
        signal: controller.signal,
      },
      protectedValues,
    })
    const abortReason = new DOMException('Selector request canceled', 'AbortError')

    controller.abort(abortReason)
    await expect(pending).rejects.toBe(abortReason)

    resolveShared({ accessToken: 'shared-access-token' })
    await Promise.resolve()
    expect(protectedValues.contains('shared-access-token')).toBe(false)
    expect(mockResolveCredentialAccessToken).toHaveBeenCalledWith(
      'credential-1',
      'owner-1',
      'selector-execution',
      undefined,
      undefined,
      { privacyMode: 'selector' }
    )
  })

  it('rechecks cancellation before consuming a fulfilled credential bundle', async () => {
    mockResolveCredentialAccessToken.mockResolvedValue({
      accessToken: 'fulfilled-access-token',
      cloudId: 'cloud-1',
    })
    const controller = new AbortController()
    const protectedValues = createSelectorProtectedValues()
    const recordCredentialUse = vi.fn()
    const abortReason = new DOMException('Selector request canceled', 'AbortError')

    const pending = resolveSelectorCredentialBundle({
      credential: {
        suppliedId: 'credential-1',
        access: { ok: true, credentialOwnerUserId: 'owner-1' },
        signal: controller.signal,
      },
      protectedValues,
      providerId: 'atlassian',
      recordCredentialUse,
    })
    queueMicrotask(() => controller.abort(abortReason))

    await expect(pending).rejects.toBe(abortReason)
    expect(protectedValues.contains('fulfilled-access-token')).toBe(false)
    expect(protectedValues.contains('cloud-1')).toBe(false)
    expect(recordCredentialUse).not.toHaveBeenCalled()
  })
})

it('resolves an organization account through its authorized browsing path without workspace authority', async () => {
  const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
  const protectedValues = createSelectorProtectedValues()
  mockResolveOrganizationToken.mockResolvedValue({
    accessToken: 'organization-secret',
    cloudId: 'cloud-1',
  })
  await expect(
    resolveSelectorCredentialBundle({
      credential: {
        suppliedId: 'credential-1',
        providerId: 'jira',
        organization: { principal, organizationId: 'org-1' },
      },
      providerId: 'jira',
      scopes: ['read:jira-work'],
      protectedValues,
    })
  ).resolves.toEqual({ accessToken: 'organization-secret', cloudId: 'cloud-1' })
  expect(mockResolveOrganizationToken).toHaveBeenCalledWith({
    principal,
    organizationId: 'org-1',
    credentialId: 'credential-1',
    requestId: 'selector-execution',
    purpose: 'browsing',
    expectedProviderId: 'jira',
    requiredScopes: ['read:jira-work'],
    impersonateEmail: undefined,
  })
  expect(protectedValues.contains('organization-secret')).toBe(true)
  expect(protectedValues.contains('cloud-1')).toBe(true)
})
