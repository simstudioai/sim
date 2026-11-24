import type { OperationFeature } from '@/lib/core/application/feature-availability'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * Workflows and workspaces as code (the source catalog and resources, workflow and workspace
 * source read and apply) ship behind the `workflow-code` flag; every source operation declares it.
 */
export const WORKFLOW_CODE_FEATURE = {
  flag: 'workflow-code',
  unavailableMessage: 'Workflows as code is in preview and not enabled for this workspace',
} as const satisfies OperationFeature

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
 * {@link WORKFLOW_CODE_FEATURE}; surfaces outside an operation (the Code tab, Copilot entitlements)
 * ask here.
 */
export function isWorkflowCodeEnabled(scope: WorkflowCodeScope): Promise<boolean> {
  return isFeatureEnabled(WORKFLOW_CODE_FEATURE.flag, scope)
}
