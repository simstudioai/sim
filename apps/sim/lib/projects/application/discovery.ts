import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { requireOrganizationSubjectMembership } from '@/lib/core/application/organization-authorization'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'

/** Project access stays inside the current, server-resolved conversation owner. */
export async function resolveCopilotProjectScope(
  principal: ResourceDelegatedPrincipal,
  assertedOrganizationId?: string
): Promise<{ organizationId: string | null; workspaceId?: string }> {
  if (principal.serviceId !== 'copilot')
    throw new OrchestrationError('forbidden', 'Project access requires Copilot delegation')
  const userId = principal.subjectUserId
  let workspaceId: string
  if (principal.invocation.kind === 'chat') {
    const chat = await resolveOwnedChatContext(principal, principal.invocation.chatId)
    if (chat.organizationId) {
      if (chat.mode !== 'agent' && chat.mode !== 'plan')
        throw new OrchestrationError('forbidden', 'Project access requires organization agent mode')
      if (assertedOrganizationId && assertedOrganizationId !== chat.organizationId)
        throw new OrchestrationError('not_found', 'Organization not found in this conversation')
      await requireOrganizationSubjectMembership(
        userId,
        chat.organizationId,
        'member',
        'copilot.use',
        undefined,
        { executor: db }
      )
      return { organizationId: chat.organizationId }
    }
    if (!chat.workspaceId) throw new OrchestrationError('not_found', 'Workspace not found')
    workspaceId = chat.workspaceId
  } else {
    workspaceId = principal.invocation.workspaceId
    if ((await getActivelyBannedUserIds([userId])).length > 0)
      throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  const [context] = await db
    .select({
      workspaceId: workspace.id,
      workspaceOrganizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (
    !context ||
    (assertedOrganizationId && assertedOrganizationId !== context.workspaceOrganizationId)
  )
    throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
  await requireCurrentHumanRole(userId, context, 'read')
  await assertWorkspaceCapability(
    userId,
    workspaceId,
    'copilot.use',
    context.workspaceOrganizationId,
    db
  )
  return { organizationId: context.workspaceOrganizationId, workspaceId }
}
