import {
  hasResourceOperationGrant,
  isWorkspaceDelegation,
  parsePrincipal,
  principalWorkspaceId,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
  resolvePrincipalSubjectUserId,
  serializePrincipal,
} from '@sim/auth/principal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const NOW = new Date('2026-10-03T12:00:00Z')
const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'acting-user',
  delegationId: 'tool-call',
  audience: 'sim:files',
  issuedAt: NOW,
  expiresAt: new Date('2026-10-03T12:01:00Z'),
  invocation: { kind: 'chat', chatId: 'chat' } as const,
  grant: { kind: 'entity', owner: { entityType: 'project', entityId: 'owner' } } as const,
} as const
const policy = {
  audience: 'sim:files',
  services: ['copilot', 'realtime'],
  maxTtlMs: 60_000,
  scope: principal.grant,
} as const

describe('resource delegation authorization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('allows owner authority to narrow to a file and preserves the actual subject', () => {
    expect(
      requireResourceDelegation(principal, {
        ...policy,
        scope: { ...principal.grant, fileId: 'file' },
      })
    ).toBe('acting-user')
    expect(resolvePrincipalSubjectUserId(principal)).toBe('acting-user')
    expect(
      resolvePrincipalAttribution(principal, { workspaceBillingOwnerUserId: 'billing-owner' })
        .attributedUserId
    ).toBe('acting-user')
    expect(resolvePrincipalAuditAttribution(principal)).toMatchObject({
      actorId: 'acting-user',
      actor: { kind: 'resource_delegated', serviceId: 'copilot', delegationId: 'tool-call' },
    })
  })

  it('allows discovery without a selected workspace', () => {
    expect(
      requireResourceDelegation(
        { ...principal, grant: { kind: 'project_discovery' } },
        { ...policy, scope: { kind: 'project_discovery' } }
      )
    ).toBe('acting-user')
  })

  it.each([
    ['another principal kind', { kind: 'session', userId: 'acting-user', sessionId: 'session' }],
    ['wrong audience', { ...principal, audience: 'sim:workflows' }],
    ['wrong service', { ...principal, serviceId: 'executor' }],
    ['missing subject', { ...principal, subjectUserId: '' }],
    ['missing delegation ID', { ...principal, delegationId: ' ' }],
    ['invalid issuance', { ...principal, issuedAt: new Date('invalid') }],
    ['invalid expiry', { ...principal, expiresAt: new Date('invalid') }],
    ['future issuance', { ...principal, issuedAt: new Date('2026-10-03T12:00:01Z') }],
    ['expired grant', { ...principal, expiresAt: NOW }],
    ['excessive lifetime', { ...principal, expiresAt: new Date('2026-10-03T12:01:01Z') }],
    ['missing chat binding', { ...principal, invocation: { kind: 'chat', chatId: '' } }],
    [
      'missing workspace binding',
      { ...principal, invocation: { kind: 'workspace', workspaceId: '' } },
    ],
    [
      'wrong invocation service',
      { ...principal, invocation: { kind: 'realtime', connectionId: 'connection' } },
    ],
    [
      'another owner type',
      {
        ...principal,
        grant: { ...principal.grant, owner: { ...principal.grant.owner, entityType: 'workspace' } },
      },
    ],
    [
      'another owner ID',
      {
        ...principal,
        grant: { ...principal.grant, owner: { ...principal.grant.owner, entityId: 'other' } },
      },
    ],
    [
      'missing owner ID',
      {
        ...principal,
        grant: { ...principal.grant, owner: { ...principal.grant.owner, entityId: '' } },
      },
    ],
    ['empty file bound', { ...principal, grant: { ...principal.grant, fileId: '' } }],
    ['discovery used for files', { ...principal, grant: { kind: 'project_discovery' } }],
    [
      'file bound widened to owner',
      { ...principal, grant: { ...principal.grant, fileId: 'file' } },
    ],
  ])('refuses %s before granting a subject', (_name, candidate) => {
    expect(() => requireResourceDelegation(candidate as never, policy)).toThrow(
      'Resource delegation is no longer valid'
    )
  })

  it('refuses a service that the operation does not admit', () => {
    expect(() =>
      requireResourceDelegation(principal, { ...policy, services: ['realtime'] })
    ).toThrow('Resource delegation is no longer valid')
  })

  it('does not let a file grant move to a sibling file', () => {
    expect(() =>
      requireResourceDelegation(
        { ...principal, grant: { ...principal.grant, fileId: 'first' } },
        { ...policy, scope: { ...principal.grant, fileId: 'second' } }
      )
    ).toThrow('Resource delegation is no longer valid')
  })

  it('does not treat matching unknown owner types as authority', () => {
    const scope = { kind: 'entity', owner: { entityType: 'unknown', entityId: 'owner' } }
    expect(() =>
      requireResourceDelegation(
        { ...principal, grant: scope } as never,
        { ...policy, scope } as never
      )
    ).toThrow()
  })

  it('does not let entity authority perform project discovery', () => {
    expect(() =>
      requireResourceDelegation(principal, { ...policy, scope: { kind: 'project_discovery' } })
    ).toThrow('Resource delegation is no longer valid')
  })

  it('requires realtime authority to identify a connection and one file', () => {
    const realtime = {
      ...principal,
      serviceId: 'realtime',
      invocation: { kind: 'realtime', connectionId: 'connection' },
      grant: { ...principal.grant, fileId: 'file' },
    } as const
    expect(requireResourceDelegation(realtime, { ...policy, scope: realtime.grant })).toBe(
      'acting-user'
    )
    for (const candidate of [
      { ...realtime, grant: principal.grant },
      { ...realtime, grant: { kind: 'project_discovery' } },
      { ...realtime, invocation: principal.invocation },
      { ...realtime, invocation: { kind: 'realtime', connectionId: '' } },
    ]) {
      expect(() =>
        requireResourceDelegation(
          candidate as never,
          { ...policy, scope: candidate.grant } as never
        )
      ).toThrow('Resource delegation is no longer valid')
    }
  })

  it('keeps realtime collection observation separate from entity and file authority', () => {
    const scope = {
      kind: 'file_collection_observation',
      owner: { entityType: 'project', entityId: 'owner' },
    } as const
    const observer = {
      ...principal,
      audience: 'sim:file-list-observation',
      serviceId: 'realtime',
      invocation: { kind: 'realtime', connectionId: 'socket' },
      grant: scope,
    } as const
    const observation = {
      ...policy,
      audience: observer.audience,
      services: ['realtime'],
      scope,
    } as const
    expect(requireResourceDelegation(observer, observation)).toBe('acting-user')
    for (const required of [
      { kind: 'entity', owner: { entityType: 'project', entityId: 'owner' } },
      { kind: 'entity', fileId: 'file', owner: { entityType: 'project', entityId: 'owner' } },
      { ...scope, owner: { ...scope.owner, entityId: 'another-owner' } },
      { kind: 'entity', owner: { entityType: 'workspace', entityId: 'owner' } },
    ]) {
      expect(() =>
        requireResourceDelegation(observer, { ...observation, scope: required } as never)
      ).toThrow('Resource delegation is no longer valid')
    }
    expect(() =>
      requireResourceDelegation(
        {
          ...observer,
          grant: { kind: 'entity', owner: { entityType: 'project', entityId: 'owner' } },
        } as never,
        observation
      )
    ).toThrow('Resource delegation is no longer valid')
    expect(() =>
      requireResourceDelegation(
        {
          ...observer,
          grant: { ...scope, owner: { ...scope.owner, entityType: 'workspace' } },
        } as never,
        observation
      )
    ).toThrow('Resource delegation is no longer valid')
    expect(() =>
      requireResourceDelegation(
        { ...observer, grant: { ...scope, fileId: 'invented-file' } } as never,
        observation
      )
    ).toThrow('Resource delegation is no longer valid')
    expect(() =>
      requireResourceDelegation(
        { ...observer, serviceId: 'copilot', invocation: principal.invocation },
        { ...observation, services: ['copilot'] }
      )
    ).toThrow('Resource delegation is no longer valid')
  })

  it('admits neither workspace nor resource operations for a workspace grant with a top-level file id', () => {
    const illegal = {
      ...principal,
      invocation: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
      grant: {
        kind: 'entity' as const,
        owner: { entityType: 'workspace' as const, entityId: 'workspace-1' },
        fileId: 'file-1',
      },
    }
    const operation = defineWorkspaceOperation({
      id: 'files.read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['copilot'],
      contentDelivery: 'none',
      capability: 'none',
    })
    expect(isWorkspaceDelegation(illegal)).toBe(false)
    expect(hasResourceOperationGrant(illegal)).toBe(false)
    expect(principalWorkspaceId(illegal)).toBeUndefined()
    expect(() => requireAllowedWorkspacePrincipal(illegal, operation)).toThrow(
      expect.objectContaining({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    )
    expect(() => requireResourceDelegation(illegal, policy)).toThrow(
      'Resource delegation is no longer valid'
    )
  })

  it('cannot be admitted to workspace operations or persisted as workflow authority', () => {
    const operation = defineWorkspaceOperation({
      id: 'files.read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['copilot'],
      contentDelivery: 'none',
      capability: 'none',
    })
    expect(() => requireAllowedWorkspacePrincipal(principal, operation)).toThrow(
      'cannot perform operation'
    )
    expect(() => serializePrincipal(principal as never)).toThrow(
      'Principal cannot be persisted for workflow execution'
    )
    expect(() => parsePrincipal({ version: 1, principal })).toThrow()
  })

  it('binds copy to both owners, the exact requested selection, and one destination folder', () => {
    const scope = {
      kind: 'file_copy',
      source: {
        owner: { entityType: 'workspace', entityId: 'source-workspace' },
        fileIds: ['one', 'two'],
        folderIds: ['folder'],
      },
      destination: {
        owner: { entityType: 'project', entityId: 'destination-project' },
        folderId: null,
      },
    } as const
    const copy = { ...principal, audience: 'sim:files:copy', grant: scope }
    const required = { ...policy, audience: copy.audience, services: ['copilot'], scope } as const
    expect(requireResourceDelegation(copy, required)).toBe('acting-user')
    expect(
      requireResourceDelegation(copy, {
        ...required,
        scope: { ...scope, source: { ...scope.source, fileIds: ['two', 'one'] } },
      })
    ).toBe('acting-user')
    for (const changed of [
      {
        ...scope,
        source: { ...scope.source, owner: { ...scope.source.owner, entityId: 'other' } },
      },
      { ...scope, source: { ...scope.source, fileIds: ['one'] } },
      { ...scope, source: { ...scope.source, fileIds: ['one', 'two', 'extra'] } },
      { ...scope, source: { ...scope.source, folderIds: ['other-folder'] } },
      {
        ...scope,
        destination: {
          ...scope.destination,
          owner: { ...scope.destination.owner, entityId: 'other' },
        },
      },
      { ...scope, destination: { ...scope.destination, folderId: 'other-folder' } },
    ])
      expect(() => requireResourceDelegation(copy, { ...required, scope: changed })).toThrow(
        'Resource delegation is no longer valid'
      )
    for (const malformed of [
      { ...scope, source: { ...scope.source, fileIds: [], folderIds: [] } },
      { ...scope, source: { ...scope.source, fileIds: ['one', 'one'] } },
      { ...scope, source: { ...scope.source, folderIds: [''] } },
      {
        ...scope,
        source: { ...scope.source, owner: { entityType: 'organization', entityId: 'org' } },
      },
      { ...scope, source: { ...scope.source, extra: true } },
      { ...scope, destination: { owner: scope.destination.owner } },
      { ...scope, destination: { ...scope.destination, folderPath: 'unresolved' } },
    ])
      expect(() =>
        requireResourceDelegation({ ...copy, grant: malformed } as never, required)
      ).toThrow('Resource delegation is no longer valid')
    for (const candidate of [
      { ...principal, audience: copy.audience },
      { ...copy, serviceId: 'realtime', invocation: { kind: 'realtime', connectionId: 'socket' } },
    ])
      expect(() => requireResourceDelegation(candidate as never, required)).toThrow(
        'Resource delegation is no longer valid'
      )
    expect(() => requireResourceDelegation(copy, { ...policy, audience: copy.audience })).toThrow(
      'Resource delegation is no longer valid'
    )
    expect(() =>
      requireResourceDelegation(copy, { ...required, scope: { kind: 'project_discovery' } })
    ).toThrow('Resource delegation is no longer valid')
  })
})
