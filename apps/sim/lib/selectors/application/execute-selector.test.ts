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
})
