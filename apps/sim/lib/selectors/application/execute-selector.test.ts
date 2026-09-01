/**
 * @vitest-environment node
 */
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  authorizeCredential: vi.fn(),
  executeAttachment: vi.fn(),
  getAttachment: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  recordCredentialAccess: vi.fn(),
  resolvePermission: vi.fn(),
  resolveReferences: vi.fn(),
  resolveScope: vi.fn(),
  sanitize: vi.fn(),
}))

vi.mock('@sim/audit', () => ({ recordAudit: vi.fn() }))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mocks.logger),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/selectors/application/resolve-scope', () => ({
  resolveSelectorApplicationContext: mocks.resolveScope,
}))

vi.mock('@/lib/oauth/token-resolution', () => ({
  recordCredentialAccess: mocks.recordCredentialAccess,
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  authorizeSelectorCredential: mocks.authorizeCredential,
}))

vi.mock('@/lib/selectors/server/references', () => ({
  resolveSelectorReferences: mocks.resolveReferences,
}))

vi.mock('@/lib/selectors/server/registry', () => ({
  getServerSelectorAttachment: mocks.getAttachment,
}))

vi.mock('@/lib/selectors/server/sanitize', () => ({
  sanitizeSelectorResult: mocks.sanitize,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

const mockResolvePermissionGroupConfig =
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

import { selectorScopeSchema } from '@/lib/api/contracts/selectors/execute'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { getSelectorManifestEntry } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const scope = { kind: 'workspace' as const, workspaceId: 'workspace-1' }

function execute(inputOverrides: Record<string, unknown> = {}) {
  return executeSelector.execute({
    principal,
    input: {
      selectorKey: 'gmail.labels',
      scope,
      context: { oauthCredential: '{{GMAIL_CREDENTIAL_ID}}' },
      request: { kind: 'list' as const },
      ...inputOverrides,
    },
  })
}

describe('executeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events.length = 0
    mocks.resolveScope.mockImplementation(async () => {
      mocks.events.push('canonical-scope')
      return {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        selectorKey: 'gmail.labels',
        selectorManifest: getSelectorManifestEntry('gmail.labels'),
        selectorScope: scope,
      }
    })
    mocks.resolvePermission.mockImplementation(async () => {
      mocks.events.push('workspace-authorization')
      return 'read'
    })
    mocks.resolveReferences.mockImplementation(async () => {
      mocks.events.push('reference-resolution')
      return {
        context: { oauthCredential: 'credential-1' },
        request: { kind: 'list' },
        references: new Map(),
      }
    })
    mocks.authorizeCredential.mockImplementation(async () => {
      mocks.events.push('credential-authorization')
      return { suppliedId: 'credential-1' }
    })
    mocks.executeAttachment.mockImplementation(async () => {
      mocks.events.push('provider-execution')
      return { kind: 'list', items: [{ id: 'label-1', label: 'Inbox' }] }
    })
    mocks.getAttachment.mockReturnValue({
      destination: 'fixed',
      credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['gmail'] },
      execute: mocks.executeAttachment,
    })
    mocks.sanitize.mockImplementation((result) => {
      mocks.events.push('sanitization')
      return result
    })
    mockResolvePermissionGroupConfig.mockResolvedValue(null)
  })

  it('authorizes canonical scope before references, credentials, and provider execution', async () => {
    await expect(execute()).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'label-1', label: 'Inbox' }],
    })

    expect(mocks.events).toEqual([
      'canonical-scope',
      'workspace-authorization',
      'reference-resolution',
      'credential-authorization',
      'provider-execution',
      'sanitization',
    ])
  })

  /**
   * The picker is a use of the integration, not a neutral list: it reaches the
   * provider's API with the caller's credential. The authorization funnel never
   * sees which integration a selector key stands for, so the allowlist decision
   * is asserted from the use case instead.
   */
  it('refuses a selector whose integration the permission group excludes', async () => {
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['slack_v2'],
    })

    await expect(execute()).rejects.toBeInstanceOf(IntegrationNotAllowedError)

    expect(mocks.events).toEqual([
      'canonical-scope',
      'workspace-authorization',
      'reference-resolution',
      'credential-authorization',
    ])
  })

  it('executes a selector whose integration the permission group names', async () => {
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['gmail_v2'],
    })

    await expect(execute()).resolves.toMatchObject({ kind: 'list' })
    expect(mocks.executeAttachment).toHaveBeenCalledTimes(1)
  })

  /**
   * A selector accepting two services would pass a check that asks whether ANY
   * declared service is allowed. The resolved credential's provider id is the
   * server-trusted narrowing, so the pair is judged as the half the caller is
   * really reaching.
   */
  it('narrows a two-service selector to the resolved credential provider', async () => {
    mocks.authorizeCredential.mockImplementation(async () => {
      mocks.events.push('credential-authorization')
      return { suppliedId: 'credential-1', providerId: 'sharepoint' }
    })
    mocks.getAttachment.mockReturnValue({
      destination: 'fixed',
      credential: {
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['sharepoint', 'microsoft-excel'],
      },
      execute: mocks.executeAttachment,
    })
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['microsoft_excel_v2'],
    })

    await expect(execute()).rejects.toBeInstanceOf(IntegrationNotAllowedError)
    expect(mocks.executeAttachment).not.toHaveBeenCalled()
  })

  /** The same pair, reached through the credential the allowlist does name. */
  it('allows a two-service selector reached through the permitted provider', async () => {
    mocks.authorizeCredential.mockImplementation(async () => {
      mocks.events.push('credential-authorization')
      return { suppliedId: 'credential-1', providerId: 'microsoft-excel' }
    })
    mocks.getAttachment.mockReturnValue({
      destination: 'fixed',
      credential: {
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['sharepoint', 'microsoft-excel'],
      },
      execute: mocks.executeAttachment,
    })
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['microsoft_excel_v2'],
    })

    await expect(execute()).resolves.toMatchObject({ kind: 'list' })
    expect(mocks.executeAttachment).toHaveBeenCalledTimes(1)
  })

  /**
   * A selector with no integration identity is not an integration: an internal
   * selector declares no credential policy at all, so an allowlist that names
   * nothing still leaves workspace files and knowledge bases pickable.
   */
  it('passes through a selector that carries no credential policy', async () => {
    mocks.getAttachment.mockReturnValue({
      destination: 'fixed',
      execute: mocks.executeAttachment,
    })
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: [],
    })

    await expect(execute()).resolves.toMatchObject({ kind: 'list' })
    expect(mocks.executeAttachment).toHaveBeenCalledTimes(1)
  })

  /** No group governs the caller, so nothing narrows the allowlist. */
  it('executes when no permission group governs the caller', async () => {
    mockResolvePermissionGroupConfig.mockResolvedValue(null)

    await expect(execute()).resolves.toMatchObject({ kind: 'list' })
    expect(mocks.executeAttachment).toHaveBeenCalledTimes(1)
  })

  it('prepares non-fixed destinations after credential authorization and before provider execution', async () => {
    const prepare = vi.fn(async () => {
      mocks.events.push('destination-preparation')
      return { baseUrl: 'https://credential-bound.example.com' }
    })
    mocks.getAttachment.mockReturnValueOnce({
      destination: { kind: 'credential-bound', prepare },
      credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['gmail'] },
      execute: vi.fn(async (_args: ExecuteServerSelectorArgs, preparedDestination: unknown) => {
        mocks.events.push('provider-execution')
        expect(preparedDestination).toEqual({
          baseUrl: 'https://credential-bound.example.com',
        })
        return { kind: 'list', items: [{ id: 'label-1', label: 'Inbox' }] }
      }),
    })

    await expect(execute()).resolves.toMatchObject({ kind: 'list' })

    expect(mocks.events).toEqual([
      'canonical-scope',
      'workspace-authorization',
      'reference-resolution',
      'credential-authorization',
      'destination-preparation',
      'provider-execution',
      'sanitization',
    ])
  })

  it('records legacy service-account use once with its trusted provider id', async () => {
    mocks.authorizeCredential.mockResolvedValueOnce({
      suppliedId: 'credential-1',
      providerId: 'atlassian-service-account',
      access: {
        ok: true,
        credentialOwnerUserId: 'owner-1',
        resolvedCredentialId: 'resolved-credential-1',
        credentialType: 'service_account',
      },
    })
    mocks.getAttachment.mockReturnValueOnce({
      destination: 'fixed',
      auditCredentialUse: true,
      credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['jira'] },
      execute: vi.fn(async (args: ExecuteServerSelectorArgs) => {
        args.recordCredentialUse?.('jira')
        args.recordCredentialUse?.('jira')
        return { kind: 'list', items: [{ id: 'project-1', label: 'Project' }] }
      }),
    })

    await execute({ auditRequest: { headers: { get: vi.fn(() => null) } } })

    expect(mocks.recordCredentialAccess).toHaveBeenCalledOnce()
    expect(mocks.recordCredentialAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        workspaceId: 'workspace-1',
        resourceId: 'resolved-credential-1',
        providerId: 'atlassian-service-account',
        credentialType: 'service_account',
      })
    )
    expect(JSON.stringify(mocks.recordCredentialAccess.mock.calls)).not.toContain(
      'GMAIL_CREDENTIAL_ID'
    )
  })

  it('logs truncation diagnostics server-side but strips them from the response', async () => {
    const { sanitizeSelectorResult } = await vi.importActual<
      typeof import('@/lib/selectors/server/sanitize')
    >('@/lib/selectors/server/sanitize')
    mocks.executeAttachment.mockResolvedValueOnce({
      kind: 'list',
      items: [{ id: 'label-1', label: 'Inbox' }],
      diagnostics: { truncated: { reason: 'provider-cap', pages: 10, limit: 2_000 } },
    })
    mocks.sanitize.mockImplementationOnce(sanitizeSelectorResult)

    await expect(execute()).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'label-1', label: 'Inbox' }],
    })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Selector provider result reached a configured cap',
      expect.objectContaining({
        selectorKey: 'gmail.labels',
        reason: 'provider-cap',
        pages: 10,
        limit: 2_000,
      })
    )
  })

  it('rejects extra context and unsupported capabilities before secret resolution', async () => {
    await expect(
      execute({
        context: { oauthCredential: 'credential-1', domain: 'tenant.example.com' },
        request: { kind: 'list', search: 'private query' },
      })
    ).rejects.toEqual(new SelectorContextUnavailableError())

    expect(mocks.events).toEqual(['canonical-scope', 'workspace-authorization'])
    expect(mocks.resolveReferences).not.toHaveBeenCalled()
    expect(mocks.authorizeCredential).not.toHaveBeenCalled()
    expect(mocks.executeAttachment).not.toHaveBeenCalled()
  })

  it('rejects oversized resolved context before credentials, destinations, or providers', async () => {
    const prepare = vi.fn(async () => ({ baseUrl: 'https://example.com' }))
    mocks.getAttachment.mockReturnValueOnce({
      destination: { kind: 'credential-bound', prepare },
      credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['gmail'] },
      execute: mocks.executeAttachment,
    })
    mocks.resolveReferences.mockImplementationOnce(async () => {
      mocks.events.push('reference-resolution')
      return {
        context: { oauthCredential: 'x'.repeat(16_385) },
        request: { kind: 'list' },
        references: new Map(),
      }
    })

    await expect(execute()).rejects.toEqual(new SelectorContextUnavailableError())

    expect(mocks.authorizeCredential).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(mocks.executeAttachment).not.toHaveBeenCalled()
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['oversized', 'x'.repeat(16_385)],
  ])(
    'rejects %s resolved detail ids before credentials, destinations, or providers',
    async (_case, resolvedId) => {
      const prepare = vi.fn(async () => ({ baseUrl: 'https://example.com' }))
      mocks.resolveScope.mockImplementationOnce(async () => {
        mocks.events.push('canonical-scope')
        return {
          workspaceId: 'workspace-1',
          workspaceOrganizationId: null,
          allowPersonalApiKeys: true,
          selectorKey: 'google.drive',
          selectorManifest: getSelectorManifestEntry('google.drive'),
          selectorScope: scope,
        }
      })
      mocks.getAttachment.mockReturnValueOnce({
        destination: { kind: 'credential-bound', prepare },
        credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['google-drive'] },
        execute: mocks.executeAttachment,
      })
      mocks.resolveReferences.mockImplementationOnce(async () => {
        mocks.events.push('reference-resolution')
        return {
          context: { oauthCredential: 'credential-1' },
          request: { kind: 'detail', id: resolvedId },
          references: new Map(),
        }
      })

      await expect(
        execute({
          selectorKey: 'google.drive',
          request: { kind: 'detail', id: '{{GOOGLE_FILE_ID}}' },
        })
      ).rejects.toEqual(new SelectorContextUnavailableError())

      expect(mocks.authorizeCredential).not.toHaveBeenCalled()
      expect(prepare).not.toHaveBeenCalled()
      expect(mocks.executeAttachment).not.toHaveBeenCalled()
      expect(mocks.logger.warn).not.toHaveBeenCalled()
    }
  )

  it('projects provider failures to a safe error and never logs request context', async () => {
    mocks.executeAttachment.mockRejectedValueOnce(
      new Error('upstream leaked selector-secret-canary for {{GMAIL_CREDENTIAL_ID}}')
    )

    await expect(execute()).rejects.toEqual(new SelectorOptionsUnavailableError())

    expect(mocks.logger.warn).toHaveBeenCalledOnce()
    const logged = JSON.stringify(mocks.logger.warn.mock.calls)
    expect(logged).not.toContain('selector-secret-canary')
    expect(logged).not.toContain('GMAIL_CREDENTIAL_ID')
    expect(logged).not.toContain('credential-1')
    expect(logged).not.toContain('context')
  })

  it.each([
    {
      name: 'restores exact detail-id repeats after sanitization',
      referenceName: 'GOOGLE_FILE_ID',
      resolvedId: 'resolved-file-id',
    },
    {
      name: 'restores a reference whose spelling overlaps its resolved ID',
      referenceName: 'ID',
      resolvedId: 'ID',
    },
  ])('$name', async ({ referenceName, resolvedId }) => {
    const { sanitizeSelectorResult } = await vi.importActual<
      typeof import('@/lib/selectors/server/sanitize')
    >('@/lib/selectors/server/sanitize')
    const originalId = `{{${referenceName}}}`

    mocks.resolveScope.mockImplementationOnce(async () => {
      mocks.events.push('canonical-scope')
      return {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        selectorKey: 'google.drive',
        selectorManifest: getSelectorManifestEntry('google.drive'),
        selectorScope: scope,
      }
    })
    mocks.resolveReferences.mockImplementationOnce(async ({ protectedValues }) => {
      mocks.events.push('reference-resolution')
      protectedValues.add(resolvedId)
      return {
        context: { oauthCredential: 'credential-1' },
        request: { kind: 'detail', id: resolvedId },
        references: new Map([
          [
            'request.id',
            {
              field: 'request.id',
              name: referenceName,
              scope: 'workspace',
              visible: false,
            },
          ],
        ]),
      }
    })
    mocks.executeAttachment.mockImplementationOnce(async () => {
      mocks.events.push('provider-execution')
      return {
        kind: 'detail',
        item: {
          id: resolvedId,
          label: resolvedId,
          meta: { resourceId: resolvedId, mimeType: 'application/pdf' },
        },
      }
    })
    mocks.sanitize.mockImplementationOnce((result, protectedValues, options) => {
      mocks.events.push('sanitization')
      expect(result).toEqual({
        kind: 'detail',
        item: {
          id: resolvedId,
          label: resolvedId,
          meta: { resourceId: resolvedId, mimeType: 'application/pdf' },
        },
      })
      expect(protectedValues.contains(resolvedId)).toBe(true)
      expect(options).toEqual({ allowedDetailExactProtectedValue: resolvedId })
      return sanitizeSelectorResult(result, protectedValues, options)
    })

    await expect(
      execute({
        selectorKey: 'google.drive',
        request: { kind: 'detail', id: originalId },
      })
    ).resolves.toEqual({
      kind: 'detail',
      item: {
        id: originalId,
        label: originalId,
        meta: { resourceId: originalId, mimeType: 'application/pdf' },
      },
    })
  })
})

describe('selector scope contract', () => {
  it('rejects workflow ids longer than 128 characters', () => {
    expect(
      selectorScopeSchema.safeParse({ kind: 'workflow', workflowId: 'w'.repeat(128) }).success
    ).toBe(true)
    expect(
      selectorScopeSchema.safeParse({ kind: 'workflow', workflowId: 'w'.repeat(129) }).success
    ).toBe(false)
  })
})
