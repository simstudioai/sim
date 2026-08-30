/**
 * @vitest-environment node
 */
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

import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { getSelectorManifestEntry } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

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
