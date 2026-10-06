import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireIssuesEnabled } from '@/lib/issues/feature-flag'
import { hasLiveIssueForBody } from '@/lib/issues/repository'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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
   * Admit an issue body (`context = 'issue'`) for this principal under the issue policy. Only
   * content reads and writes pass it; every other file operation never reaches an issue body.
   */
  issueBodyPrincipal?: Principal
}

/**
 * Principals the issue operations admit. A delegated caller must be Sim itself: a workflow's File
 * tool delegates as the executor, and the issue operations refuse it.
 */
const ISSUE_BODY_PRINCIPAL_KINDS = new Set<Principal['kind']>([
  'session',
  'personal_api_key',
  'oauth_access_token',
])

function isIssueBodyPrincipal(principal: Principal): boolean {
  return principal.kind === 'delegated'
    ? principal.serviceId === 'copilot'
    : ISSUE_BODY_PRINCIPAL_KINDS.has(principal.kind)
}

/** An issue body follows its live issue: the rollout flag, and the issue operations' principal kinds. */
export async function assertIssueBodyAccess(
  principal: Principal,
  context: ActiveWorkspaceFileContext
): Promise<void> {
  if (context.fileContext !== 'issue') return
  if (!isIssueBodyPrincipal(principal) || !(await hasLiveIssueForBody(context.fileId))) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await requireIssuesEnabled(context.workspaceOrganizationId)
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const canonical = await loadActiveWorkspaceFileContext(input.fileId, {
    includeDeleted: input.includeDeleted,
    includeChatUploads: input.includeChatUploads,
    ...(input.issueBodyPrincipal ? { includeIssueBodies: true } : {}),
  })
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  if (input.issueBodyPrincipal) await assertIssueBodyAccess(input.issueBodyPrincipal, canonical)
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
