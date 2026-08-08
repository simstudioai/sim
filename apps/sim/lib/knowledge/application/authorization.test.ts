/**
 * @vitest-environment node
 */

import type { DelegatedPrincipal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_DELEGATION_AUDIENCE,
  knowledgeDelegationPolicy,
} from '@/lib/knowledge/application/authorization'
import { createKnowledgeDelegatedPrincipal } from '@/lib/knowledge/application/delegated-principal'

describe('knowledge delegation policy', () => {
  it('binds trusted delegation to the canonical workspace and audience', () => {
    const principal = createKnowledgeDelegatedPrincipal({
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'tool-call-1',
      chatId: 'chat-1',
    })

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
    const principal: DelegatedPrincipal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'tool-call-1',
      audience: 'model:chosen',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }

    expect(principal.audience).not.toBe(knowledgeDelegationPolicy.audience)
  })
})
