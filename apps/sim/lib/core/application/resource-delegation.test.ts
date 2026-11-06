import {
  parsePrincipal,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
  resolvePrincipalSubjectUserId,
  serializePrincipal,
} from '@sim/auth/principal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const NOW = new Date('2026-10-03T12:00:00Z')
const principal = {
  kind: 'resource_delegated',
  serviceId: 'copilot',
  subjectUserId: 'acting-user',
  delegationId: 'tool-call',
  audience: 'sim:files',
  issuedAt: NOW,
  expiresAt: new Date('2026-10-03T12:01:00Z'),
  invocation: { kind: 'chat', chatId: 'chat' },
  scope: { kind: 'entity', entityType: 'project', entityId: 'owner' },
} as const
const policy = {
  audience: 'sim:files',
  services: ['copilot', 'realtime'],
  maxTtlMs: 60_000,
  scope: principal.scope,
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
        scope: { ...principal.scope, fileId: 'file' },
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
        { ...principal, scope: { kind: 'project_discovery' } },
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
      { ...principal, scope: { ...principal.scope, entityType: 'workspace' } },
    ],
    ['another owner ID', { ...principal, scope: { ...principal.scope, entityId: 'other' } }],
    ['missing owner ID', { ...principal, scope: { ...principal.scope, entityId: '' } }],
    ['empty file bound', { ...principal, scope: { ...principal.scope, fileId: '' } }],
    ['discovery used for files', { ...principal, scope: { kind: 'project_discovery' } }],
    [
      'file bound widened to owner',
      { ...principal, scope: { ...principal.scope, fileId: 'file' } },
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
        { ...principal, scope: { ...principal.scope, fileId: 'first' } },
        { ...policy, scope: { ...principal.scope, fileId: 'second' } }
      )
    ).toThrow('Resource delegation is no longer valid')
  })

  it('does not treat matching unknown owner types as authority', () => {
    const scope = { kind: 'entity', entityType: 'unknown', entityId: 'owner' }
    expect(() =>
      requireResourceDelegation({ ...principal, scope } as never, { ...policy, scope } as never)
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
      scope: { ...principal.scope, fileId: 'file' },
    } as const
    expect(requireResourceDelegation(realtime, { ...policy, scope: realtime.scope })).toBe(
      'acting-user'
    )
    for (const candidate of [
      { ...realtime, scope: principal.scope },
      { ...realtime, scope: { kind: 'project_discovery' } },
      { ...realtime, invocation: principal.invocation },
      { ...realtime, invocation: { kind: 'realtime', connectionId: '' } },
    ]) {
      expect(() =>
        requireResourceDelegation(
          candidate as never,
          { ...policy, scope: candidate.scope } as never
        )
      ).toThrow('Resource delegation is no longer valid')
    }
  })

  it('keeps realtime collection observation separate from entity and file authority', () => {
    const scope = {
      kind: 'file_collection_observation',
      entityType: 'project',
      entityId: 'owner',
    } as const
    const observer = {
      ...principal,
      audience: 'sim:file-list-observation',
      serviceId: 'realtime',
      invocation: { kind: 'realtime', connectionId: 'socket' },
      scope,
    } as const
    const observation = {
      ...policy,
      audience: observer.audience,
      services: ['realtime'],
      scope,
    } as const
    expect(requireResourceDelegation(observer, observation)).toBe('acting-user')
    for (const required of [
      { kind: 'entity', entityType: 'project', entityId: 'owner' },
      { kind: 'entity', entityType: 'project', entityId: 'owner', fileId: 'file' },
      { ...scope, entityId: 'another-owner' },
      { kind: 'entity', entityType: 'workspace', entityId: 'owner' },
    ]) {
      expect(() =>
        requireResourceDelegation(observer, { ...observation, scope: required } as never)
      ).toThrow('Resource delegation is no longer valid')
    }
    expect(() =>
      requireResourceDelegation(
        {
          ...observer,
          scope: { kind: 'entity', entityType: 'project', entityId: 'owner' },
        } as never,
        observation
      )
    ).toThrow('Resource delegation is no longer valid')
    expect(() =>
      requireResourceDelegation(
        { ...observer, scope: { ...scope, entityType: 'workspace' } } as never,
        observation
      )
    ).toThrow('Resource delegation is no longer valid')
    expect(() =>
      requireResourceDelegation(
        { ...observer, scope: { ...scope, fileId: 'invented-file' } } as never,
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

  it('cannot be admitted to workspace operations or persisted as workflow authority', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'files.read',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['resource_delegated'],
        capability: 'none',
      })
    ).toThrow('cannot accept resource delegation')
    expect(() => serializePrincipal(principal as never)).toThrow(
      'Principal cannot be persisted for workflow execution'
    )
    expect(() => parsePrincipal({ version: 1, principal })).toThrow(
      'Resource delegation cannot be persisted for workflow execution'
    )
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
    const copy = { ...principal, audience: 'sim:files:copy', scope }
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
        requireResourceDelegation({ ...copy, scope: malformed } as never, required)
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
