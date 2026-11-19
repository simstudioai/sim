import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Where a workflows-as-code surface runs: the workspace, its organization (null for a personal
 * workspace) and the acting user, each matched against its allowlist in the `workflow-code` flag.
 * A missing id skips its clause.
 */
export interface WorkflowCodeScope {
  orgId?: string | null
  workspaceId?: string | null
  userId?: string | null
}

/**
 * Workflows and workspaces as code (the SDK block catalog and resources, workflow source and
 * workspace source read and apply, the Code tab) ship behind one `workflow-code` flag, rolled out
 * globally or by organization, workspace or user; every surface of the feature gates through here.
 */
export function isWorkflowCodeEnabled(scope: WorkflowCodeScope): Promise<boolean> {
  return isFeatureEnabled('workflow-code', scope)
}

/** Where a source use case runs: a workspace and that workspace's organization. */
interface WorkflowCodeContext {
  workspaceId: string
  workspaceOrganizationId: string | null
}

/**
 * Whether workflows as code is enabled where a use case runs: its workspace, that workspace's
 * organization, or the principal's user.
 */
export function isWorkflowCodeEnabledFor(
  principal: Principal,
  context: WorkflowCodeContext
): Promise<boolean> {
  return isWorkflowCodeEnabled({
    orgId: context.workspaceOrganizationId,
    workspaceId: context.workspaceId,
    userId: resolvePrincipalSubjectUserId(principal),
  })
}

/** Throws `forbidden` unless {@link isWorkflowCodeEnabledFor} holds. */
export async function requireWorkflowCodeEnabled(
  principal: Principal,
  context: WorkflowCodeContext
): Promise<void> {
  if (!(await isWorkflowCodeEnabledFor(principal, context))) {
    throw new OrchestrationError(
      'forbidden',
      'Workflows as code is in preview and not enabled for this workspace'
    )
  }
}
