/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), execute: vi.fn() }))

vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-secrets/operations', () => ({
  executeOciSecretsOperation: mocks.execute,
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociSecretsSelectorAttachments } from '@/lib/selectors/server/providers/oci-secrets'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const client = { request: vi.fn() }

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_secrets.secrets',
    context: {
      oauthCredential: 'selected-credential',
      compartmentId: 'discovery-compartment',
      vaultId: 'vault-1',
      region: 'us-phoenix-1',
    },
    request: { kind: 'list', cursor: 'page-2' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'selected-credential',
      access: {
        ok: true,
        resolvedCredentialId: 'canonical-credential',
        credentialType: 'service_account',
        workspaceId: 'workspace-1',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

describe('OCI Secrets server selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue(client)
  })

  it('prepares the canonical credential and region, and projects only safe secret options', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        secrets: [
          {
            id: 'secret-1',
            secretName: 'database-password',
            lifecycleState: 'ACTIVE',
            metadata: { value: 'private-metadata' },
            secretBundleContent: { content: 'private-content' },
          },
        ],
        nextPage: 'page-3',
      },
    })
    const signal = new AbortController().signal
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.secrets'].execute(args({ signal }))
    ).resolves.toEqual({
      kind: 'list',
      items: [
        {
          id: 'secret-1',
          label: 'database-password',
          meta: { lifecycleState: 'ACTIVE' },
        },
      ],
      nextCursor: 'page-3',
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'canonical-credential',
      workspaceId: 'workspace-1',
      serviceId: 'oci_secrets',
      region: 'us-phoenix-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      {
        operation: 'list_secrets',
        oauthCredential: 'canonical-credential',
        compartmentId: 'discovery-compartment',
        vaultId: 'vault-1',
        limit: 100,
        page: 'page-2',
      },
      signal
    )
  })

  it('reuses the prepared client and projects vault labels without endpoint URLs', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        vaults: [
          {
            id: 'vault-1',
            displayName: 'Production',
            lifecycleState: 'ACTIVE',
            managementEndpoint: 'https://private-endpoint.example',
          },
        ],
      },
    })
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.vaults'].execute(
        args({ selectorKey: 'oci_secrets.vaults' }),
        client
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'vault-1', label: 'Production', meta: { lifecycleState: 'ACTIVE' } }],
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.execute.mock.calls[0][1]).toMatchObject({
      operation: 'list_vaults',
      compartmentId: 'discovery-compartment',
    })
  })

  it.each(['HSM', 'SOFTWARE'])(
    'requests AES keys with the selected %s protection mode',
    async (mode) => {
      mocks.execute.mockResolvedValue({
        success: true,
        output: {
          keys: [
            {
              id: 'aes-1',
              displayName: 'Encryption',
              algorithm: 'AES',
              lifecycleState: 'ENABLED',
              protectionMode: mode,
            },
            { id: 'rsa-1', displayName: 'Signing', algorithm: 'RSA', lifecycleState: 'ENABLED' },
            { id: 'aes-2', displayName: 'Disabled', algorithm: 'AES', lifecycleState: 'DISABLED' },
          ],
          nextPage: 'page-3',
        },
      })
      await expect(
        ociSecretsSelectorAttachments['oci_secrets.keys'].execute(
          args({
            selectorKey: 'oci_secrets.keys',
            context: { compartmentId: 'key-compartment', vaultId: 'vault-1', protectionMode: mode },
          })
        )
      ).resolves.toEqual({
        kind: 'list',
        items: [{ id: 'aes-1', label: 'Encryption', meta: { protectionMode: mode } }],
        nextCursor: 'page-3',
      })
      expect(mocks.execute.mock.calls[0][1]).toMatchObject({
        operation: 'list_keys',
        compartmentId: 'key-compartment',
        vaultId: 'vault-1',
        algorithm: 'AES',
        protectionMode: mode,
      })
    }
  )

  it('preserves continuation after filtering an empty key page and defaults to HSM', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        keys: [{ id: 'disabled', algorithm: 'AES', lifecycleState: 'DISABLED' }],
        nextPage: 'page-3',
      },
    })
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.keys'].execute(
        args({ selectorKey: 'oci_secrets.keys' })
      )
    ).resolves.toEqual({ kind: 'list', items: [], nextCursor: 'page-3' })
    expect(mocks.execute.mock.calls[0][1].protectionMode).toBe('HSM')
  })

  it('retains enabled keys when the AES-filtered response omits the optional algorithm', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        keys: [
          {
            id: 'aes-1',
            displayName: 'Encryption',
            algorithm: null,
            lifecycleState: 'ENABLED',
            protectionMode: 'HSM',
          },
        ],
        nextPage: 'page-3',
      },
    })
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.keys'].execute(
        args({ selectorKey: 'oci_secrets.keys' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'aes-1', label: 'Encryption', meta: { protectionMode: 'HSM' } }],
      nextCursor: 'page-3',
    })
    expect(mocks.execute.mock.calls[0][1].algorithm).toBe('AES')
  })

  it.each([
    undefined,
    { suppliedId: 'credential-1' },
    {
      suppliedId: 'credential-1',
      access: {
        ok: true,
        resolvedCredentialId: 'canonical',
        credentialType: 'service_account' as const,
        workspaceId: 'other',
      },
    },
  ])('rejects unbound or mismatched credentials before provider work', async (credential) => {
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.secrets'].execute(args({ credential }))
    ).rejects.toMatchObject({ name: 'SelectorConnectionUnavailableError' })
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects missing discovery context before a provider operation', async () => {
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.keys'].execute(
        args({
          selectorKey: 'oci_secrets.keys',
          context: { compartmentId: 'compartment-1' },
        }),
        client
      )
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('bounds provider failures without forwarding their content', async () => {
    mocks.execute.mockRejectedValue(new OciClientError('request_failed', { status: 429 }))
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.secrets'].execute(args(), client)
    ).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
      message: 'Options unavailable',
      status: 429,
    })
  })

  it('preserves cancellation from the listing operation', async () => {
    const controller = new AbortController()
    mocks.execute.mockImplementation(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      throw controller.signal.reason
    })
    await expect(
      ociSecretsSelectorAttachments['oci_secrets.secrets'].execute(
        args({ signal: controller.signal }),
        client
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
