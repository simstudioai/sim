import type { z } from 'zod'
import {
  type mothershipResourceAttachmentSchema,
  mothershipResourceSchema,
} from '@/lib/api/contracts/mothership-resources'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { resolveOwnedFileContext } from '@/lib/mothership/chat/process-contents'
import { isOwnerScopedFile } from '@/lib/mothership/file-owners'
import type { ChatContextItem } from '@/lib/mothership/generated/protocol'

/**
 * Resolves an open file panel against its owner's current authority. The returned tab keeps the
 * panel's own identity for workspace files, so a legacy address is not rewritten into a new key.
 */
export async function resolveFileAttachment(
  resource: z.infer<typeof mothershipResourceAttachmentSchema>,
  scope: {
    userId: string
    workspaceId?: string
    organizationId?: string
    chatId?: string
    requestMode?: string
  }
): Promise<{ context: ChatContextItem; tab?: z.infer<typeof mothershipResourceSchema> }> {
  const { userId, workspaceId, organizationId, chatId, requestMode } = scope
  if (resource.viewId || resource.currentView) throw new Error('Invalid file resource target')
  const usesWorkspace = !resource.owner || !isOwnerScopedFile(resource.owner)
  const assertedWorkspaceId = usesWorkspace
    ? (resource.owner?.entityId ?? resource.workspaceId)
    : undefined
  if (resource.workspaceId && (!usesWorkspace || resource.workspaceId !== assertedWorkspaceId))
    throw new Error('File owner conflicts with the selected workspace')
  const target = usesWorkspace
    ? organizationId || assertedWorkspaceId
      ? await resolveInvocationWorkspace(
          { userId, workspaceId, organizationId, chatId },
          assertedWorkspaceId
        )
      : workspaceId
        ? { workspaceId }
        : null
    : null
  const owner =
    resource.owner ??
    (target ? { entityType: 'workspace' as const, entityId: target.workspaceId } : null)
  if (!owner || (usesWorkspace && !target)) throw new Error('File resource requires an owner')
  const readContext = () =>
    resolveOwnedFileContext(
      { owner, fileId: resource.id },
      { userId, workspaceId: target?.workspaceId ?? workspaceId, chatId, requestMode }
    )
  const ctx = target
    ? await withWorkspaceInvocationScope(
        { workspaceId: target.workspaceId, organizationId },
        readContext
      )
    : await readContext()
  const tab = ctx.resource
    ? mothershipResourceSchema.parse({
        ...resource,
        ...ctx.resource,
        ...(usesWorkspace ? { owner: resource.owner } : {}),
        ...(organizationId && target
          ? { workspaceId: target.workspaceId }
          : { workspaceId: undefined, workspaceName: undefined }),
      })
    : undefined
  return {
    context: {
      ...ctx,
      ...(organizationId && target
        ? { content: `Workspace ${target.workspaceId}:\n${ctx.content}` }
        : {}),
      tag: resource.active ? '@active_tab' : '@open_tab',
    },
    ...(tab ? { tab } : {}),
  }
}
