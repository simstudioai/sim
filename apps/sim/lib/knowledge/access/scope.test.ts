import type { Principal } from '@sim/auth/principal'
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAvailability,
  mockCheckWorkspaceAccess,
  mockGitHubReadGrants,
  mockConfluenceReadGrants,
  mockCsvGrants,
  mockLiveSources,
} = vi.hoisted(() => ({
  mockLiveSources: {
    github: vi.fn(() => ({ type: 'github-sources' })),
    confluence: vi.fn(() => ({ type: 'confluence-sources' })),
    knowledgeBases: vi.fn(() => ({ type: 'live-knowledge-bases' })),
  },
  mockAvailability: vi.fn(async () => ({ memberScoped: true, sourceMirrored: true })),
  mockCheckWorkspaceAccess: vi.fn(async () => ({ hasAccess: true })),
  mockGitHubReadGrants: vi.fn(async () => []),
  mockConfluenceReadGrants: vi.fn(async () => []),
  mockCsvGrants: vi.fn(async () => [] as string[]),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mockAvailability,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))
vi.mock('@/lib/knowledge/access/confluence-site', () => ({
  resolveConfluenceSiteReadGrants: mockConfluenceReadGrants,
}))
vi.mock('@/lib/knowledge/access/github-installation', () => ({
  resolveGitHubInstallationReadGrants: mockGitHubReadGrants,
}))
vi.mock('@/lib/knowledge/access/live-sources', () => ({
  githubInstallationSourceCondition: mockLiveSources.github,
  confluenceSiteSourceCondition: mockLiveSources.confluence,
  liveSourceKnowledgeBaseCondition: mockLiveSources.knowledgeBases,
}))
vi.mock('@/lib/knowledge/access/connector-permissions', () => ({
  loadConnectorPermissionGroupTokens: mockCsvGrants,
}))

import { MAX_EXTERNAL_GROUP_TOKENS } from '@/lib/knowledge/access/group-membership'
import {
  createKnowledgeAccessProvider,
  resolveKnowledgeAccessScope,
} from '@/lib/knowledge/access/scope'

const SESSION: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const WORKSPACE = { workspaceId: 'ws-1' }

function queueSubjects(rows: Array<Record<string, string | null>>) {
  queueTableRows(schemaMock.user, rows)
}

describe('resolveKnowledgeAccessScope', () => {
  beforeEach(() => {
    resetDbChainMock()
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

  it('rejects missing ownership before querying document access', async () => {
    await expect(resolveKnowledgeAccessScope(SESSION, {})).rejects.toThrow(
      'Resource requires exactly one workspace or organization owner'
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
    resetDbChainMock()
  })

  it('scopes live-source discovery to sources a held reader credential can prove', async () => {
    queueSubjects([{ providerId: 'slack', providerTenantId: 'T1', providerSubjectId: 'U1' }])
    await expect(
      createKnowledgeAccessProvider(SESSION, WORKSPACE).liveSourceConnectorCondition()
    ).resolves.toBeNull()

    queueSubjects([
      {
        providerId: 'confluence',
        providerTenantId: 'site-1',
        providerSubjectId: 'account-1',
        credentialId: 'credential-1',
      },
    ])
    const condition = await createKnowledgeAccessProvider(
      SESSION,
      WORKSPACE
    ).liveSourceConnectorCondition()
    expect(condition).not.toBeNull()
    expect(mockLiveSources.confluence).toHaveBeenCalledOnce()
    expect(mockLiveSources.github).not.toHaveBeenCalled()
    expect(mockLiveSources.knowledgeBases).toHaveBeenCalledExactlyOnceWith(
      { kind: 'workspace', workspaceId: 'ws-1' },
      undefined
    )
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'inArray' && node.column === schemaMock.knowledgeConnector.knowledgeBaseId
      )
    ).toBe(true)
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
    resetDbChainMock()
  })

  function queueGroups(rows: Array<Record<string, string | null>>) {
    queueTableRows(schemaMock.knowledgeExternalGroupMember, rows)
  }

  it('fails closed on the direct-group overflow sentinel before discarding malformed tokens', async () => {
    queueSubjects([
      { providerId: 'confluence', providerTenantId: null, providerSubjectId: 'reader' },
    ])
    queueGroups(
      Array.from({ length: MAX_EXTERNAL_GROUP_TOKENS + 1 }, () => ({
        providerId: 'invalid:provider',
        tenantId: 'cloud',
        externalGroupId: 'group',
      }))
    )
    await expect(resolveKnowledgeAccessScope(SESSION, WORKSPACE)).rejects.toThrow('token capacity')
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
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
})

describe('each token family is gated by the feature it depends on', () => {
  beforeEach(() => {
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
})

describe('organization document ACL scope', () => {
  const organization = { organizationId: 'org-1' }
  beforeEach(() => {
    resetDbChainMock()
  })
  it('cannot check a retained Confluence connection after organization removal', async () => {
    queueTableRows(schemaMock.member, [])
    queueSubjects([
      {
        credentialId: 'personal-confluence',
        providerId: 'confluence',
        providerSubjectId: 'alice',
        providerTenantId: null,
      },
    ])
    const provider = createKnowledgeAccessProvider(SESSION, organization)
    expect(await provider.getForConnectors(['confluence-source'])).toMatchObject({ tokens: [] })
    expect(mockConfluenceReadGrants).not.toHaveBeenCalled()
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
})
