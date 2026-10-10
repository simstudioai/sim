import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { ownedFileKind } from '@/lib/workspace-files/owned-files'
import { matchesFileOwner } from '@/lib/workspace-files/ownership'

export interface WorkspaceFileContextInput {
  fileId: string
  assertedWorkspaceId?: string
  includeDeleted?: boolean
  /**
   * Admit a chat upload (`context = 'mothership'`) addressed by its own id. Only read
   * use cases set this: chat uploads stay out of listings and closed to writes.
   */
  includeChatUploads?: boolean
  /**
   * Admit a file another resource owns (a test file or a release body) for this principal under
   * its owner's policy. Only content reads and writes pass it; every other file operation never
   * reaches an owned file.
   */
  ownedFilePrincipal?: Principal
}

/**
 * The principals the owners' operations admit: people and Copilot acting for one. Workspace API
 * keys, system callers, and the executor's delegation never reach an owned file.
 */
function isOwnedFilePrincipal(principal: Principal): boolean {
  if (principal.kind === 'delegated') return principal.serviceId === 'copilot'
  return (
    principal.kind === 'session' ||
    principal.kind === 'personal_api_key' ||
    principal.kind === 'oauth_access_token'
  )
}

/**
 * A file another resource owns follows its owner: it needs a live owner with its feature
 * enabled, and admits only the owners' principal kinds.
 */
export async function assertOwnedFileAccess(
  principal: Principal,
  context: ActiveWorkspaceFileContext
): Promise<void> {
  const kind = ownedFileKind(context.fileContext)
  if (!kind) return
  if (!isOwnedFilePrincipal(principal)) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await kind.assertOwnerAccess(context.fileId, context.workspaceOrganizationId)
}

function requireWorkspaceFileContext<C extends ActiveWorkspaceFileContext>(
  canonical: C | null,
  assertedWorkspaceId: string | undefined
): C {
  if (
    !canonical ||
    (assertedWorkspaceId !== undefined &&
      !matchesFileOwner(
        { entityType: 'workspace', entityId: canonical.workspaceId },
        { entityType: 'workspace', entityId: assertedWorkspaceId }
      ))
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const canonical = requireWorkspaceFileContext(
    await loadActiveWorkspaceFileContext(input.fileId, {
      includeDeleted: input.includeDeleted,
      includeChatUploads: input.includeChatUploads,
      includeOwnedFiles: Boolean(input.ownedFilePrincipal),
    }),
    input.assertedWorkspaceId
  )
  if (input.ownedFilePrincipal) await assertOwnedFileAccess(input.ownedFilePrincipal, canonical)
  return canonical
}

export async function resolveWorkspaceFileLifecycleContext(
  input: WorkspaceFileContextInput
): Promise<WorkspaceFileLifecycleContext> {
  return requireWorkspaceFileContext(
    await loadWorkspaceFileLifecycleContext(input.fileId),
    input.assertedWorkspaceId
  )
}
