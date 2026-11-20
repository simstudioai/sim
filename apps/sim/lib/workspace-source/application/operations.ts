import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { WORKFLOW_CODE_FEATURE } from '@/lib/workflows/code/feature-flag'

const SOURCE_OPERATION_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  feature: WORKFLOW_CODE_FEATURE,
} as const

/**
 * Reads and applies a whole workspace as source. Each change runs through the child use case
 * that owns it (`createTableUseCase`, `applyWorkflowSource`, …), which enforces its own role,
 * capability and workspace-key policy: a workspace API key may read and apply here, and a child
 * that refuses it (workflow and skill use cases deny workspace keys) is reported per resource as
 * `E_APPLY_FORBIDDEN` before anything is written. Staging blobs (and asking which are staged) is a
 * step of an apply, so it needs the apply's role and is scoped to the caller. Not offered to
 * Copilot.
 */
export const workspaceSourceOperations = {
  // permission-group-exempt: each kind's resources are read through their own use cases, which apply that kind's capability
  read: defineWorkspaceOperation({
    id: 'workspaces.source.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_OPERATION_POLICY,
  }),
  /**
   * What an apply of a submitted directory would do, without writing: the read behind
   * `sim workspaces source status`. Each change is still checked by the use case that owns it, so a
   * member who may not write a kind sees that change refused in the plan.
   */
  // permission-group-exempt: a plan stores nothing; each change is checked by the use case that owns it, which applies that kind's capability
  plan: defineWorkspaceOperation({
    id: 'workspaces.source.plan',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_OPERATION_POLICY,
  }),
  // permission-group-exempt: each change runs through the use case that owns it, which applies that kind's capability
  apply: defineWorkspaceOperation({
    id: 'workspaces.source.apply',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_OPERATION_POLICY,
  }),
  // permission-group-exempt: staged bytes are inert until an apply writes them through the use case that owns each kind
  stageBlobs: defineWorkspaceOperation({
    id: 'workspaces.source.blobs.stage',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_OPERATION_POLICY,
  }),
  // permission-group-exempt: it reports which of the caller's own staged hashes are absent
  findMissingBlobs: defineWorkspaceOperation({
    id: 'workspaces.source.blobs.missing',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...SOURCE_OPERATION_POLICY,
  }),
} as const
