/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMemberAccessAvailable } = vi.hoisted(() => ({
  mockMemberAccessAvailable: vi.fn(async () => true),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mockMemberAccessAvailable,
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
    expect(dbChainMockFns.leftJoin).toHaveBeenCalledTimes(2)
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
