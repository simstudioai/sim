/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createCopilotChatTablePrincipal } from '@/lib/copilot/auth/table-delegation'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'

describe('chat table delegation', () => {
  it('satisfies the table read policy only for the mentioned table', () => {
    const principal = createCopilotChatTablePrincipal(
      { userId: 'user-1', workspaceId: 'workspace-1', chatId: 'chat-1' },
      'table-1'
    )
    const context = {
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    }
    expect(principal).toMatchObject({
      subjectUserId: 'user-1',
      audience: tableDelegationPolicy.audience,
      resourceScope: { tableId: 'table-1', chatId: 'chat-1' },
    })
    expect(tableDelegationPolicy.isWithinScope(principal, { ...context, tableId: 'table-1' })).toBe(
      true
    )
    expect(tableDelegationPolicy.isWithinScope(principal, { ...context, tableId: 'table-2' })).toBe(
      false
    )
    expect(tableDelegationPolicy.isWithinScope(principal, context)).toBe(false)
  })
})
