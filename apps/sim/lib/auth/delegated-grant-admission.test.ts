/**
 * @vitest-environment node
 */
import {
  hasResourceOperationGrant,
  isWorkspaceDelegation,
  parsePrincipal,
  principalWorkspaceId,
  type ResourceDelegationScope,
  serializePrincipal,
  workspaceDelegationRestrictions,
} from '@sim/auth/principal'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { describe, expect, it } from 'vitest'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

const issuedAt = new Date('2026-01-01T00:00:00.000Z')
const expiresAt = new Date('2099-01-01T00:00:00.000Z')
const workspaceOperation = defineWorkspaceOperation({
  id: 'test.workspace-grant',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
  contentDelivery: 'none',
  capability: 'none',
})
const resourcePolicy = {
  audience: 'sim:files',
  services: ['copilot'],
  maxTtlMs: 60_000,
  scope: { kind: 'entity', owner: { entityType: 'project', entityId: 'project-1' } },
} as const

function copilotEnvelope(
  grant: ResourceDelegationScope,
  invocation: { kind: 'chat'; chatId: string } | { kind: 'workspace'; workspaceId: string }
) {
  return {
    kind: 'delegated' as const,
    serviceId: 'copilot' as const,
    subjectUserId: 'user-1',
    delegationId: 'delegation-1',
    audience: 'sim:test',
    issuedAt,
    expiresAt,
    invocation,
    grant,
  }
}

const workspaceGrant = {
  kind: 'entity' as const,
  owner: { entityType: 'workspace' as const, entityId: 'workspace-1' },
}
const illegalFileGrant = { ...workspaceGrant, fileId: 'file-1' }

describe('delegated grant admission', () => {
  it('rejects a workspace entity grant that also names a top-level file', () => {
    const principal = copilotEnvelope(illegalFileGrant, {
      kind: 'workspace',
      workspaceId: 'workspace-1',
    })
    expect(isWorkspaceDelegation(principal)).toBe(false)
    expect(hasResourceOperationGrant(principal)).toBe(false)
    expect(principalWorkspaceId(principal)).toBeUndefined()
    expect(() => requireAllowedWorkspacePrincipal(principal, workspaceOperation)).toThrow(
      expect.objectContaining({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    )
    expect(() => requireResourceDelegation(principal, resourcePolicy)).toThrow(
      'Resource delegation is no longer valid'
    )
    expect(() => markCopilotWorkspaceInvocation(principal)).toThrow(/current/)
  })

  it('rejects a workspace invocation that names a different workspace than the grant', () => {
    const principal = {
      ...createDelegatedPrincipal({ workspaceId: 'workspace-1' }),
      invocation: { kind: 'workspace' as const, workspaceId: 'other' },
    }
    expect(isWorkspaceDelegation(principal)).toBe(false)
    expect(principalWorkspaceId(principal)).toBeUndefined()
  })

  it('rejects a chat invocation whose chat id is absent from restrictions', () => {
    const principal = {
      ...createDelegatedPrincipal({ workspaceId: 'workspace-1', resourceScope: {} }),
      invocation: { kind: 'chat' as const, chatId: 'chat-1' },
    }
    expect(isWorkspaceDelegation(principal)).toBe(false)
    expect(workspaceDelegationRestrictions(principal)?.chatId).toBeUndefined()
  })

  it('accepts a chat invocation that matches restrictions and reads the grant owner', () => {
    const principal = {
      ...createDelegatedPrincipal({
        workspaceId: 'workspace-1',
        resourceScope: { chatId: 'chat-1' },
      }),
      invocation: { kind: 'chat' as const, chatId: 'chat-1' },
    }
    expect(isWorkspaceDelegation(principal)).toBe(true)
    expect(principalWorkspaceId(principal)).toBe('workspace-1')
  })

  it('keeps an empty restriction object from bypassing a required chat id', () => {
    const principal = createDelegatedPrincipal({
      workspaceId: 'workspace-1',
      resourceScope: {},
    })
    expect(isWorkspaceDelegation(principal)).toBe(true)
    expect(workspaceDelegationRestrictions(principal)?.chatId).toBeUndefined()
  })

  it('keeps a project entity grant on the resource side of the partition', () => {
    const principal = copilotEnvelope(
      { kind: 'entity', owner: { entityType: 'project', entityId: 'project-1' } },
      { kind: 'chat', chatId: 'chat-1' }
    )
    expect(hasResourceOperationGrant(principal)).toBe(true)
    expect(isWorkspaceDelegation(principal)).toBe(false)
    expect(principalWorkspaceId(principal)).toBeUndefined()
  })

  it('keeps a copilot workspace-file chat invocation across a snapshot round-trip', () => {
    const minted = createWorkspaceFileDelegatedPrincipal({
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      fileId: 'file-1',
      chatId: 'chat-1',
    })
    if (minted.serviceId !== 'copilot') throw new Error('Expected a copilot file principal')
    expect(minted.invocation).toEqual({ kind: 'chat', chatId: 'chat-1' })
    expect(minted.grant.restrictions).toMatchObject({ fileId: 'file-1', chatId: 'chat-1' })
    const parsed = parsePrincipal(serializePrincipal(minted))
    if (parsed.kind !== 'delegated' || parsed.serviceId === 'executor')
      throw new Error('Expected a subject delegation')
    expect(parsed.invocation).toEqual({ kind: 'chat', chatId: 'chat-1' })
    expect(parsed.grant.restrictions).toMatchObject({ fileId: 'file-1', chatId: 'chat-1' })
  })

  it('parses a realtime workspace payload as a workspace invocation', () => {
    const parsed = parsePrincipal({
      version: 1,
      principal: {
        kind: 'delegated',
        serviceId: 'realtime',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:test',
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date('2026-01-01T00:05:00.000Z').toISOString(),
      },
    })
    if (parsed.kind !== 'delegated' || parsed.serviceId !== 'realtime')
      throw new Error('Expected a realtime delegation')
    expect(parsed.invocation).toEqual({ kind: 'workspace', workspaceId: 'workspace-1' })
    expect(parsed).not.toHaveProperty('connectionId')
  })
})
