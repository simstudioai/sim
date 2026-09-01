/**
 * @vitest-environment node
 */

import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeCredentialUse: vi.fn(),
  credentialProviderMatchesService: vi.fn(),
  getServiceConfig: vi.fn(),
  resolveCredentialTokenBundle: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mocks.authorizeCredentialUse,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialTokenBundle: mocks.resolveCredentialTokenBundle,
}))

vi.mock('@/lib/oauth/utils', () => ({
  credentialProviderMatchesService: mocks.credentialProviderMatchesService,
  getServiceConfigByServiceId: mocks.getServiceConfig,
}))

import {
  authorizeSelectorCredential,
  resolveSelectorOAuthAccessToken,
} from '@/lib/selectors/server/credentials'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const policy = {
  kind: 'stored' as const,
  field: 'oauthCredential' as const,
  serviceIds: ['gmail'],
}

function authorize(): Promise<unknown> {
  return authorizeSelectorCredential({
    principal,
    context: { oauthCredential: 'credential-1' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    policy,
    protectedValues: createSelectorProtectedValues(),
    references: new Map(),
  })
}

describe('authorizeSelectorCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getServiceConfig.mockReturnValue({ id: 'gmail' })
  })

  it('conceals a credential authorized in a different workspace', async () => {
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-2',
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'credential-1',
    })

    await expect(authorize()).rejects.toEqual(new SelectorConnectionUnavailableError())
    expect(mocks.credentialProviderMatchesService).not.toHaveBeenCalled()
  })

  it('pins workspace-scoped credential authorization before legacy account resolution', async () => {
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-1',
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'account-1',
    })
    queueTableRows(credential, [{ accountId: 'account-1', providerId: 'google' }])
    mocks.credentialProviderMatchesService.mockReturnValue(true)

    await expect(authorize()).resolves.toMatchObject({ suppliedId: 'credential-1' })
    expect(mocks.authorizeCredentialUse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
      })
    )
  })

  it('promotes a hidden fixed token to an authentication secret at every length', async () => {
    const protectedValues = createSelectorProtectedValues()

    await expect(
      authorizeSelectorCredential({
        principal,
        context: { oauthCredential: 'xoxb-a' },
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
        workspaceId: 'workspace-1',
        policy: {
          kind: 'stored-or-fixed-token',
          field: 'oauthCredential',
          serviceIds: ['slack'],
          tokenPrefixes: ['xoxb-'],
        },
        protectedValues,
        references: new Map([
          [
            'oauthCredential',
            {
              field: 'oauthCredential',
              name: 'SLACK_BOT_TOKEN',
              scope: 'workspace',
              visible: false,
            },
          ],
        ]),
      })
    ).resolves.toMatchObject({ fixedToken: 'xoxb-a' })

    expect(protectedValues.contains('prefix-xoxb-a-suffix')).toBe(true)
    expect(mocks.authorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('conceals a stored credential whose trusted provider does not match the selector service', async () => {
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      workspaceId: 'workspace-1',
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'credential-1',
    })
    queueTableRows(credential, [{ accountId: 'account-1', providerId: 'microsoft' }])
    mocks.credentialProviderMatchesService.mockReturnValue(false)

    await expect(authorize()).rejects.toEqual(new SelectorConnectionUnavailableError())
    expect(mocks.credentialProviderMatchesService).toHaveBeenCalledWith('microsoft', {
      id: 'gmail',
    })
  })
})

describe('resolveSelectorOAuthAccessToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects only the canceled waiter while shared credential work serves another caller', async () => {
    let resolveShared!: (value: { accessToken: string }) => void
    const sharedResolution = new Promise<{ accessToken: string }>((resolve) => {
      resolveShared = resolve
    })
    mocks.resolveCredentialTokenBundle.mockReturnValue(sharedResolution)
    const canceledController = new AbortController()
    const liveController = new AbortController()
    const canceledProtectedValues = createSelectorProtectedValues()
    const liveProtectedValues = createSelectorProtectedValues()
    const canceledRecordUse = vi.fn()
    const liveRecordUse = vi.fn()
    const access = {
      ok: true as const,
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'credential-1',
    }

    const canceledWaiter = resolveSelectorOAuthAccessToken({
      credential: {
        suppliedId: 'credential-1',
        access,
        signal: canceledController.signal,
      },
      serviceId: 'gmail',
      protectedValues: canceledProtectedValues,
      recordCredentialUse: canceledRecordUse,
    })
    const liveWaiter = resolveSelectorOAuthAccessToken({
      credential: {
        suppliedId: 'credential-1',
        access,
        signal: liveController.signal,
      },
      serviceId: 'gmail',
      protectedValues: liveProtectedValues,
      recordCredentialUse: liveRecordUse,
    })

    const abortReason = new DOMException('Selector request canceled', 'AbortError')
    canceledController.abort(abortReason)
    await expect(canceledWaiter).rejects.toBe(abortReason)

    resolveShared({ accessToken: 'shared-access-token' })
    await expect(liveWaiter).resolves.toBe('shared-access-token')

    expect(canceledRecordUse).not.toHaveBeenCalled()
    expect(canceledProtectedValues.contains('shared-access-token')).toBe(false)
    expect(liveRecordUse).toHaveBeenCalledOnce()
    expect(liveProtectedValues.contains('shared-access-token')).toBe(true)
    expect(mocks.resolveCredentialTokenBundle).toHaveBeenCalledTimes(2)
    for (const call of mocks.resolveCredentialTokenBundle.mock.calls) {
      expect(call[5]).toEqual({ privacyMode: 'selector' })
      expect(call).not.toContain(canceledController.signal)
      expect(call).not.toContain(liveController.signal)
    }
  })

  it('does not start credential resolution for an already canceled selector', async () => {
    const controller = new AbortController()
    const abortReason = new DOMException('Selector request canceled', 'AbortError')
    controller.abort(abortReason)

    await expect(
      resolveSelectorOAuthAccessToken({
        credential: {
          suppliedId: 'credential-1',
          access: {
            ok: true,
            credentialOwnerUserId: 'owner-1',
            resolvedCredentialId: 'credential-1',
          },
          signal: controller.signal,
        },
        serviceId: 'gmail',
        protectedValues: createSelectorProtectedValues(),
      })
    ).rejects.toBe(abortReason)

    expect(mocks.resolveCredentialTokenBundle).not.toHaveBeenCalled()
  })

  it('rechecks cancellation before consuming a fulfilled credential result', async () => {
    mocks.resolveCredentialTokenBundle.mockResolvedValue({
      accessToken: 'fulfilled-access-token',
    })
    const controller = new AbortController()
    const protectedValues = createSelectorProtectedValues()
    const recordCredentialUse = vi.fn()
    const abortReason = new DOMException('Selector request canceled', 'AbortError')

    const pending = resolveSelectorOAuthAccessToken({
      credential: {
        suppliedId: 'credential-1',
        access: {
          ok: true,
          credentialOwnerUserId: 'owner-1',
          resolvedCredentialId: 'credential-1',
        },
        signal: controller.signal,
      },
      serviceId: 'gmail',
      protectedValues,
      recordCredentialUse,
    })
    queueMicrotask(() => controller.abort(abortReason))

    await expect(pending).rejects.toBe(abortReason)
    expect(protectedValues.contains('fulfilled-access-token')).toBe(false)
    expect(recordCredentialUse).not.toHaveBeenCalled()
  })
})
