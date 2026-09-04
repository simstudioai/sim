/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAvailability, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockAvailability: vi.fn(async () => ({ memberScoped: true, sourceMirrored: true })),
  mockCheckWorkspaceAccess: vi.fn(async () => ({ hasAccess: true })),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mockAvailability,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import {
  createKnowledgeAccessProvider,
  resolveKnowledgeAccessScope,
  WORKSPACE_ACCESS_SCOPE,
} from '@/lib/knowledge/access/scope'

const SESSION: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const WORKSPACE = { workspaceId: 'ws-1' }

function queueSubjects(rows: Array<Record<string, string | null>>) {
  queueTableRows(schemaMock.user, rows)
}

describe('resolveKnowledgeAccessScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('gives a person the workspace pair plus one token per active managed credential', async () => {
    queueSubjects([
      { providerId: 'confluence', providerTenantId: null, providerSubjectId: '557058:abc' },
      { providerId: 'google-drive', providerTenantId: 'acme.com', providerSubjectId: '42' },
      { providerId: 'confluence', providerTenantId: null, providerSubjectId: '557058:abc' },
    ])

    const scope = await resolveKnowledgeAccessScope(SESSION, WORKSPACE)

    expect(scope).toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 's:confluence:-:557058:abc', 's:google-drive:acme.com:42', 'ws'],
    })
    expect(dbChainMockFns.leftJoin).toHaveBeenCalledTimes(3)
  })

  /**
   * `user_email_lower_unique` makes this state unreachable. The guard exists so
   * access control does not depend on the constraint still being there.
   */
  it('binds no identity token when another account folds to the same address', async () => {
    queueSubjects([
      {
        emailIsAmbiguous: true,
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:abc',
      },
    ] as never)

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
  })

  it('binds normally when the address identifies exactly one account', async () => {
    queueSubjects([
      {
        emailIsAmbiguous: false,
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:abc',
      },
    ] as never)

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 's:confluence:-:557058:abc', 'ws'],
    })
  })

  it('grants no member token to someone who is no longer in the workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({ hasAccess: false })
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('grants no identity token where permission-aware knowledge is off, whatever the person holds', async () => {
    mockAvailability.mockResolvedValueOnce({ memberScoped: false, sourceMirrored: false })
    queueSubjects([
      { providerId: 'google-drive', providerTenantId: 'acme.com', providerSubjectId: '42' },
    ])
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
  })

  it('falls back to the workspace pair for a person with no credential, and for one who is unverified or unknown', async () => {
    queueSubjects([{ providerId: null, providerTenantId: null, providerSubjectId: null }])
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })

    resetDbChainMock()
    queueSubjects([])
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
  })

  it('skips a malformed credential row instead of failing the read', async () => {
    queueSubjects([
      { providerId: 'a:b', providerTenantId: null, providerSubjectId: 'x' },
      { providerId: 'slack', providerTenantId: 'T1', providerSubjectId: 'U1' },
    ])
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 's:slack:T1:U1', 'ws'],
    })
  })

  it('does not query for a legacy personal knowledge base', async () => {
    await expect(resolveKnowledgeAccessScope(SESSION, {})).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it.each<[string, Principal]>([
    ['a workspace API key', { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'key-1' }],
    [
      'a scheduled run',
      { kind: 'system', serviceId: 'schedule', workspaceId: 'ws-1', workflowId: 'wf-1' },
    ],
    [
      'a webhook run with an external subject',
      {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        webhookId: 'wh-1',
        provider: 'slack',
        subject: { kind: 'external_user', provider: 'slack', tenantId: 'T1', subjectId: 'U1' },
      },
    ],
    [
      'an executor run whose trigger was a workspace key',
      {
        kind: 'delegated',
        serviceId: 'executor',
        workspaceId: 'ws-1',
        delegationId: 'd-1',
        audience: 'sim:knowledge',
        issuedAt: 0,
        expiresAt: 1,
        delegationContext: {
          principal: { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'key-1' },
          compatibilityActor: { userId: 'deployer' },
          currentWorkflow: { workflowId: 'wf-1', mode: 'deployment' },
        },
      } as unknown as Principal,
    ],
  ])('resolves %s to the workspace scope without a lookup', async (_label, principal) => {
    await expect(resolveKnowledgeAccessScope(principal, WORKSPACE)).resolves.toBe(
      WORKSPACE_ACCESS_SCOPE
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('follows an executor delegation back to the person who triggered it', async () => {
    queueSubjects([])
    const executor = {
      kind: 'delegated',
      serviceId: 'executor',
      workspaceId: 'ws-1',
      delegationId: 'd-1',
      audience: 'sim:knowledge',
      issuedAt: 0,
      expiresAt: 1,
      delegationContext: {
        principal: SESSION,
        currentWorkflow: { workflowId: 'wf-1', mode: 'draft' },
      },
    } as unknown as Principal

    await expect(resolveKnowledgeAccessScope(executor, WORKSPACE)).resolves.toMatchObject({
      kind: 'user',
      userId: 'user-1',
    })
  })

  it('refuses a Credential Group enrollment principal', async () => {
    await expect(
      resolveKnowledgeAccessScope(
        {
          kind: 'credential_group_enrollment',
          workspaceId: 'ws-1',
          credentialGroupId: 'g',
          enrollmentId: 'e',
          email: 'a@b.c',
          invitationTokenHash: 'h',
        } as Principal,
        WORKSPACE
      )
    ).rejects.toThrow('cannot read knowledge documents')
  })
})

describe('createKnowledgeAccessProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves once per operation and shares the result', async () => {
    queueSubjects([{ providerId: 'slack', providerTenantId: 'T1', providerSubjectId: 'U1' }])
    const provider = createKnowledgeAccessProvider(SESSION, WORKSPACE)

    const [first, second] = await Promise.all([provider.get(), provider.get()])

    expect(first).toBe(second)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed lookup rather than caching the failure', async () => {
    dbChainMockFns.where.mockRejectedValueOnce(new Error('connection reset'))
    const provider = createKnowledgeAccessProvider(SESSION, WORKSPACE)

    await expect(provider.get()).rejects.toThrow('connection reset')
    queueSubjects([])
    await expect(provider.get()).resolves.toMatchObject({ kind: 'user', tokens: ['pub', 'ws'] })
  })
})

describe('tokens mirrored from a source directory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  function queueGroups(rows: Array<Record<string, string | null>>) {
    queueTableRows(schemaMock.knowledgeExternalGroupMember, rows)
  }

  it('gives a person their own address and every group it belongs to', async () => {
    queueSubjects([
      {
        email: 'alice@corp.com',
        providerId: null,
        providerTenantId: null,
        providerSubjectId: null,
      },
    ])
    queueGroups([
      { providerId: 'google-drive', tenantId: 'corp.com', externalGroupId: 'eng@corp.com' },
      { providerId: 'google-drive', tenantId: 'corp.com', externalGroupId: 'all@corp.com' },
    ])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: [
        'g:google-drive:corp.com:all@corp.com',
        'g:google-drive:corp.com:eng@corp.com',
        'pub',
        'u:alice@corp.com',
        'ws',
      ],
    })
  })

  /**
   * A domain share is stored as a group with one wildcard member; a reader at
   * that domain holds the group's token without ever being enumerated.
   */
  it('gives a person the groups their domain wildcard is a member of', async () => {
    queueSubjects([
      {
        email: 'alice@corp.com',
        providerId: null,
        providerTenantId: null,
        providerSubjectId: null,
      },
    ])
    queueGroups([
      { providerId: 'google-drive', tenantId: 'corp.com', externalGroupId: 'domain:corp.com' },
    ])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toMatchObject({
      tokens: expect.arrayContaining(['g:google-drive:corp.com:domain:corp.com']),
    })
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it('still gives a person their own address when they are in no group', async () => {
    queueSubjects([
      {
        email: 'alice@corp.com',
        providerId: null,
        providerTenantId: null,
        providerSubjectId: null,
      },
    ])
    queueGroups([])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'u:alice@corp.com', 'ws'],
    })
  })

  it('binds nothing to an address two accounts share, groups included', async () => {
    queueSubjects([
      {
        emailIsAmbiguous: true,
        email: 'alice@corp.com',
        providerId: null,
        providerTenantId: null,
        providerSubjectId: null,
      },
    ] as never)

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 'ws'],
    })
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
  })

  it('skips a malformed group rather than failing the read', async () => {
    queueSubjects([
      {
        email: 'alice@corp.com',
        providerId: null,
        providerTenantId: null,
        providerSubjectId: null,
      },
    ])
    queueGroups([
      { providerId: 'a:b', tenantId: 'corp.com', externalGroupId: 'eng@corp.com' },
      { providerId: 'google-drive', tenantId: 'corp.com', externalGroupId: 'eng@corp.com' },
    ])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['g:google-drive:corp.com:eng@corp.com', 'pub', 'u:alice@corp.com', 'ws'],
    })
  })
})

describe('each token family is gated by the feature it depends on', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * Admin mode mirrors a source's own ACLs and touches no Credential Group, so
   * an operator turning Credential Groups off must not silently revoke every
   * document an administrator crawl mirrored.
   */
  it('keeps mirrored grants when Credential Groups are unavailable', async () => {
    mockAvailability.mockResolvedValueOnce({ memberScoped: false, sourceMirrored: true })
    queueTableRows(schemaMock.user, [
      {
        email: 'alice@corp.com',
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:abc',
      },
    ])
    queueTableRows(schemaMock.knowledgeExternalGroupMember, [
      { providerId: 'google-drive', tenantId: 'corp.com', externalGroupId: 'eng@corp.com' },
    ])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['g:google-drive:corp.com:eng@corp.com', 'pub', 'u:alice@corp.com', 'ws'],
    })
  })

  it('keeps member grants when source mirroring is unavailable', async () => {
    mockAvailability.mockResolvedValueOnce({ memberScoped: true, sourceMirrored: false })
    queueTableRows(schemaMock.user, [
      {
        email: 'alice@corp.com',
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:abc',
      },
    ])

    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['pub', 's:confluence:-:557058:abc', 'ws'],
    })
  })
})
