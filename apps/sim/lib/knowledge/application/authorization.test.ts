/**
 * @vitest-environment node
 */

import type { DelegatedPrincipal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_DELEGATION_AUDIENCE,
  knowledgeDelegationPolicy,
} from '@/lib/knowledge/application/authorization'

function createKnowledgePrincipal(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'tool-call-1',
    audience: KNOWLEDGE_DELEGATION_AUDIENCE,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat-1' },
    ...overrides,
  }
}

describe('knowledge delegation policy', () => {
  it('binds trusted delegation to the canonical workspace and audience', () => {
    const principal = createKnowledgePrincipal()

    expect(principal.audience).toBe(KNOWLEDGE_DELEGATION_AUDIENCE)
    expect(principal.resourceScope).toEqual({ chatId: 'chat-1' })
    expect(
      knowledgeDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
      })
    ).toBe(true)
    expect(
      knowledgeDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-2',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
      })
    ).toBe(false)
  })

  it('does not accept a model-authored audience', () => {
    const principal = createKnowledgePrincipal({ audience: 'model:chosen' })

    expect(principal.audience).not.toBe(knowledgeDelegationPolicy.audience)
  })

  it('accepts a correctly scoped executor delegation for executor-enabled operations', () => {
    const principal: DelegatedPrincipal = {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'execution-1',
      audience: KNOWLEDGE_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }

    expect(
      knowledgeDelegationPolicy.isWithinScope(principal, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
      })
    ).toBe(true)
  })
})
