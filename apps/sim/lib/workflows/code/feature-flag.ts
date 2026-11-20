import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

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
 * globally or by organization, workspace or user. Source operations declare it as
 * `WORKFLOW_CODE_FEATURE`; surfaces outside an operation (the Code tab, Copilot entitlements) ask here.
 */
export function isWorkflowCodeEnabled(scope: WorkflowCodeScope): Promise<boolean> {
  return isFeatureEnabled('workflow-code', scope)
}
