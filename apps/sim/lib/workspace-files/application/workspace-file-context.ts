import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { requireWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { getLiveWorkflowTestByBodyFileId } from '@/lib/workflow-tests/repository'

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
   * Admit a file another resource owns — a test file (`context = 'test'`) — for this principal under its owner's policy. Only content reads and
   * writes pass it; every other file operation never reaches an owned file.
   */
  ownedFilePrincipal?: Principal
}

/**
 * The principals the test operations admit: people and Copilot acting for one. Workspace API
 * keys, system callers, and the executor's delegation never reach a test file.
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
 * A test file follows its test: it needs a live test and admits only the test operations'
 * principal kinds.
 */
export async function assertOwnedFileAccess(
  principal: Principal,
  context: ActiveWorkspaceFileContext
): Promise<void> {
  if (context.fileContext !== 'test') return
  if (!isOwnedFilePrincipal(principal)) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  if (!(await getLiveWorkflowTestByBodyFileId(context.fileId))) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await requireWorkflowTestsEnabled(context.workspaceOrganizationId)
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const canonical = await loadActiveWorkspaceFileContext(input.fileId, {
    includeDeleted: input.includeDeleted,
    includeChatUploads: input.includeChatUploads,
    ...(input.ownedFilePrincipal ? { includeTestFiles: true } : {}),
  })
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  if (input.ownedFilePrincipal) await assertOwnedFileAccess(input.ownedFilePrincipal, canonical)
  return canonical
}

export async function resolveWorkspaceFileLifecycleContext(
  input: WorkspaceFileContextInput
): Promise<WorkspaceFileLifecycleContext> {
  const canonical = await loadWorkspaceFileLifecycleContext(input.fileId)
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}
