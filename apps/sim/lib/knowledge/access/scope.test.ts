/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, inArray } from 'drizzle-orm'
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
      tokens: [],
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

  it('rejects missing ownership before querying document access', async () => {
    await expect(resolveKnowledgeAccessScope(SESSION, {})).rejects.toThrow(
      'Resource requires exactly one workspace or organization owner'
    )
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
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
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

  it('matches source groups through an active provider identity when the source hides member emails', async () => {
    queueSubjects([
      {
        email: 'alice@corp.com',
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: '557058:MixedCase',
      },
    ])
    queueGroups([{ providerId: 'confluence', tenantId: 'cloud-A', externalGroupId: 'engineers' }])
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).resolves.toMatchObject({
      tokens: [
        'g:confluence:cloud-A:engineers',
        'pub',
        's:confluence:-:557058:MixedCase',
        'u:alice@corp.com',
        'ws',
      ],
    })
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

  it('keeps verified email groups but excludes subject-derived grants when managed identities are unavailable', async () => {
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
    expect(inArray).toHaveBeenCalledWith(schemaMock.knowledgeExternalGroupMember.subjectToken, [
      'u:alice@corp.com',
      'u:*@corp.com',
    ])
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

describe('organization document ACL scope', () => {
  const organization = { organizationId: 'org-1' }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  it('uses current organization membership and org baseline without any workspace membership', async () => {
    queueTableRows(schemaMock.member, [{ id: 'membership-1' }])
    queueSubjects([
      {
        email: 'viewer@example.com',
        providerId: 'google-email',
        providerTenantId: null,
        providerSubjectId: 'gmail-subject',
      },
    ])
    await expect(resolveKnowledgeAccessScope(SESSION, organization)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['org', 'pub', 's:google-email:-:gmail-subject', 'u:viewer@example.com'],
    })
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })
  it('binds org indexing identities to the enrolled Sim user rather than a matching email', async () => {
    queueTableRows(schemaMock.member, [{ id: 'membership-1' }])
    queueSubjects([])
    await resolveKnowledgeAccessScope(SESSION, organization)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, schemaMock.user.id)
  })
  it('grants nothing after removal, even when stored provider grants remain', async () => {
    queueTableRows(schemaMock.member, [])
    queueSubjects([
      {
        email: 'viewer@example.com',
        providerId: 'google-email',
        providerTenantId: null,
        providerSubjectId: 'gmail-subject',
      },
    ])
    await expect(resolveKnowledgeAccessScope(SESSION, organization)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: [],
    })
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })
  it('grants no identity-derived documents to an unverified org account', async () => {
    queueTableRows(schemaMock.member, [{ id: 'membership-1' }])
    queueSubjects([])
    await expect(resolveKnowledgeAccessScope(SESSION, organization)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['org', 'pub'],
    })
  })
  it('does not inherit a workspace key creator identity for organization search', async () => {
    await expect(
      resolveKnowledgeAccessScope(
        { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'key-1' },
        organization
      )
    ).rejects.toThrow('requires a user subject')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('keeps a disabled permission-aware feature on the org baseline only', async () => {
    queueTableRows(schemaMock.member, [{ id: 'membership-1' }])
    mockAvailability.mockResolvedValueOnce({ memberScoped: false, sourceMirrored: false })
    await expect(resolveKnowledgeAccessScope(SESSION, organization)).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
      tokens: ['org', 'pub'],
    })
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
  })
})
