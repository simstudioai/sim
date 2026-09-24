/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'

const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: false,
  billedAccountUserId: 'actor',
  tableId: 'table',
}
function principal(tableId?: string) {
  return createCopilotChatPrincipal(
    { userId: 'actor', workspaceId: 'workspace', chatId: 'chat' },
    tableDelegationPolicy.audience,
    tableId ? { tableId } : undefined
  )
}
describe('private table workspace invocation', () => {
  it('admits only the in-process workspace grant and loses it on copying/recovery', () => {
    const caller = principal()
    expect(tableDelegationPolicy.isWithinScope(caller, context)).toBe(false)
    markCopilotWorkspaceInvocation(caller)
    expect(tableDelegationPolicy.isWithinScope(caller, context)).toBe(true)
    expect(tableDelegationPolicy.isWithinScope({ ...caller }, context)).toBe(false)
  })
  it('never overrides a narrower table grant or a different workspace', () => {
    const caller = principal('other')
    markCopilotWorkspaceInvocation(caller)
    expect(tableDelegationPolicy.isWithinScope(caller, context)).toBe(false)
    const broad = principal()
    markCopilotWorkspaceInvocation(broad)
    expect(tableDelegationPolicy.isWithinScope(broad, { ...context, workspaceId: 'other' })).toBe(
      false
    )
  })
  it('keeps unbranded exact-table access and refuses expired admission', () => {
    expect(tableDelegationPolicy.isWithinScope(principal('table'), context)).toBe(true)
    expect(() =>
      markCopilotWorkspaceInvocation({ ...principal(), expiresAt: new Date(0) })
    ).toThrow(/current/)
    expect(() => markCopilotWorkspaceInvocation({ ...principal(), serviceId: 'executor' })).toThrow(
      /current/
    )
  })
})
