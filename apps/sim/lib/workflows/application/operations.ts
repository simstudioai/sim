import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const ALL_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const

const WORKFLOW_READ_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

const HUMAN_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

const WORKFLOW_DEPLOYMENT_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

const COPILOT_WORKFLOW_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

export const workflowOperations = {
  // permission-group-exempt: listing the workflows in a workspace is governed by workspace role; no group hides the workflow module
  list: defineWorkspaceOperation({
    id: 'workflows.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reading a workflow is governed by workspace role, not by a group capability
  read: defineWorkspaceOperation({
    id: 'workflows.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...WORKFLOW_READ_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reporting where a workflow is already deployed is a read of existing state; a group withholds the act of deploying, not the record of it
  readDeploymentOverview: defineWorkspaceOperation({
    id: 'workflows.deployment_overview.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reading a workflow's run inputs is workflow content; Chat itself is withheld by copilot.use at the chat surface
  readCopilotRunOptions: defineWorkspaceOperation({
    id: 'workflows.copilot.run_options.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reading a block's declared outputs is workflow content; Chat itself is withheld by copilot.use at the chat surface
  readCopilotBlockOutputs: defineWorkspaceOperation({
    id: 'workflows.copilot.block_outputs.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: resolving which upstream blocks a block may reference is workflow content; Chat itself is withheld by copilot.use at the chat surface
  readCopilotUpstreamReferences: defineWorkspaceOperation({
    id: 'workflows.copilot.upstream_references.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow module has no hide key, so creating a workflow is governed by workspace role alone
  create: defineWorkspaceOperation({
    id: 'workflows.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: renaming or re-describing a workflow is governed by workspace role
  update: defineWorkspaceOperation({
    id: 'workflows.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  /**
   * Denied to workspace API keys for the same reason as its sibling
   * {@link applyOperations} below, and stated here because the two are the only
   * doors that write a whole graph through this surface.
   *
   * A replace stores blocks and their tool wiring wholesale. The policies that
   * decide which of those a member may add — the EE permission config and block
   * visibility — take a human subject, and an actorless workspace key has none;
   * both available substitutes fail *open*. Allowing one here made `PUT …/state`
   * a way to store what `POST …/operations` refuses.
   *
   * Personal keys keep the capability, so headless authoring is unaffected for a
   * credential that names a human.
   *
   * permission-group-exempt: which blocks a member may store is judged against allowedIntegrations inside replaceWorkflowNormalizedState, which this use case passes the principal's human subject to, not by a capability the authorization funnel can apply
   */
  replaceState: defineWorkspaceOperation({
    id: 'workflows.state.replace',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  /**
   * Denied to workspace API keys, unlike its sibling writes.
   *
   * Applying an edit batch authorizes against three per-user policies — the EE
   * permission config, block visibility, and credential reachability — and all
   * three take a human subject. An actorless workspace key has none, and the
   * two available substitutes both fail *open*: attributing to the workspace
   * billing owner evaluates the batch as the least-restricted account in the
   * workspace, and passing no user at all makes `getUserPermissionConfig`
   * return `null`, which every caller reads as "unrestricted". Either way a
   * workspace whose members are constrained by an allowlist would be edited as
   * though it were not.
   *
   * Personal keys keep the capability, so headless editing is unaffected for a
   * credential that names a human. Re-open this to workspace keys only once the
   * three lookups can express a workspace-scoped policy that fails closed.
   *
   * permission-group-exempt: which blocks a member may store is judged against allowedIntegrations inside replaceWorkflowNormalizedState, which this use case passes the principal's human subject to, not by a capability the authorization funnel can apply
   */
  applyOperations: defineWorkspaceOperation({
    id: 'workflows.operations.apply',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: restoring a soft-deleted workflow is governed by workspace role
  restore: defineWorkspaceOperation({
    id: 'workflows.restore',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: a workflow's run policy is workspace-admin configuration; no group capability withholds it
  updatePolicy: defineWorkspaceOperation({
    id: 'workflows.policy.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workflow variables are workflow content, governed by workspace role
  applyVariableOperations: defineWorkspaceOperation({
    id: 'workflows.variables.apply_operations',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: toggling a block edits workflow content; which integrations a member may use is allowedIntegrations, enforced against the block type rather than the operation
  setBlockEnabled: defineWorkspaceOperation({
    id: 'workflows.blocks.set_enabled',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: moving workflows between folders is placement, governed by workspace role
  moveBulk: defineWorkspaceOperation({
    id: 'workflows.bulk.move',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow file tree has no hide key; arranging it is governed by workspace role
  createVfsFolders: defineWorkspaceOperation({
    id: 'workflows.vfs.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow file tree has no hide key; arranging it is governed by workspace role
  moveVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow file tree has no hide key; arranging it is governed by workspace role
  copyVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.copy',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow file tree has no hide key; arranging it is governed by workspace role
  deleteVfsItems: defineWorkspaceOperation({
    id: 'workflows.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: duplicating copies a graph the caller may already read into the same workspace, so it crosses no capability boundary
  duplicate: defineWorkspaceOperation({
    id: 'workflows.duplicate',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: running a workflow is governed by workspace role; Chat itself is withheld by copilot.use at the chat surface
  runFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  // permission-group-exempt: running a workflow is governed by workspace role; Chat itself is withheld by copilot.use at the chat surface
  runUntilFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_until',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: running a workflow is governed by workspace role; Chat itself is withheld by copilot.use at the chat surface
  runFromBlockFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_from_block',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: running a single block is governed by workspace role; Chat itself is withheld by copilot.use at the chat surface
  runBlockFromCopilot: defineWorkspaceOperation({
    id: 'workflows.copilot.run_block',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: deleting a workflow is governed by workspace role
  delete: defineWorkspaceOperation({
    id: 'workflows.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow folder tree has no hide key; reading it is governed by workspace role
  listFolders: defineWorkspaceOperation({
    id: 'workflows.folders.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow folder tree has no hide key; arranging it is governed by workspace role
  createFolder: defineWorkspaceOperation({
    id: 'workflows.folders.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow folder tree has no hide key; arranging it is governed by workspace role
  relocateFolder: defineWorkspaceOperation({
    id: 'workflows.folders.relocate',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: the workflow folder tree has no hide key; arranging it is governed by workspace role
  deleteFolder: defineWorkspaceOperation({
    id: 'workflows.folders.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  deploy: defineWorkspaceOperation({
    id: 'workflows.deploy',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.api',
    ...WORKFLOW_DEPLOYMENT_PRINCIPAL_POLICY,
  }),
  undeploy: defineWorkspaceOperation({
    id: 'workflows.undeploy',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.api',
    ...WORKFLOW_DEPLOYMENT_PRINCIPAL_POLICY,
  }),
  deployChat: defineWorkspaceOperation({
    id: 'workflows.chat.deploy',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.chat',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  undeployChat: defineWorkspaceOperation({
    id: 'workflows.chat.undeploy',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.chat',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  /**
   * Toggling unauthenticated public execution is an admin-role change a human
   * key-holder may legitimately make from a script, so personal API keys are
   * accepted alongside sessions. Workspace keys stay denied and Copilot is not
   * a principal here: the operation removes the authentication requirement from
   * a deployed workflow, which needs an accountable human rather than a machine
   * credential or an agent acting on a prompt.
   *
   * permission-group-exempt: `public_api.use` is asserted inside the use case and only for the enabling direction, because a group that withholds public execution must still let an admin withdraw execution a workflow already has
   */
  updatePublicApi: defineWorkspaceOperation({
    id: 'workflows.public_api.update',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  }),
  activateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.activate',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'deploy.api',
    ...WORKFLOW_DEPLOYMENT_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: reverting the draft to an earlier version edits workflow content; deployment capabilities govern what is served, not what is edited
  revertVersion: defineWorkspaceOperation({
    id: 'workflows.versions.revert',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...HUMAN_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: a version's name and description are metadata on workflow content, governed by workspace role
  updateVersion: defineWorkspaceOperation({
    id: 'workflows.versions.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: version history is workflow content, governed by workspace role
  listVersions: defineWorkspaceOperation({
    id: 'workflows.versions.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...WORKFLOW_READ_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: version history is workflow content, governed by workspace role
  readVersion: defineWorkspaceOperation({
    id: 'workflows.versions.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...WORKFLOW_READ_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: comparing references across two versions reads workflow content the caller may already open
  compareReferences: defineWorkspaceOperation({
    id: 'workflows.versions.compare_references',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...COPILOT_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: an export returns the graph its reader can already open; logs.export withholds execution logs, not definitions
  export: defineWorkspaceOperation({
    id: 'workflows.export',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: importing is workflow authoring governed by workspace role; the blocks the payload carries are judged against allowedIntegrations before they are persisted
  import: defineWorkspaceOperation({
    id: 'workflows.import',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: running a workflow from an authenticated surface is governed by workspace role; public_api.use withholds the unauthenticated surface, which does not reach this operation
  execute: defineWorkspaceOperation({
    id: 'workflows.execute',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: a manual run is governed by workspace role; public_api.use withholds the unauthenticated surface, which does not reach this operation
  executeManual: defineWorkspaceOperation({
    id: 'workflows.manual.execute',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token'],
  }),
  // permission-group-exempt: a manual run is governed by workspace role; public_api.use withholds the unauthenticated surface, which does not reach this operation
  executeManualFromBlock: defineWorkspaceOperation({
    id: 'workflows.manual.execute_from_block',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token'],
  }),
  // permission-group-exempt: execution history is governed by workspace role; logs.cost and logs.trace_spans withhold fields inside a run, not the right to read one
  listRuns: defineWorkspaceOperation({
    id: 'workflows.runs.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: execution history is governed by workspace role; logs.cost and logs.trace_spans withhold fields inside a run, not the right to read one
  readRun: defineWorkspaceOperation({
    id: 'workflows.runs.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: a paused execution's detail is pause points and resume state, not the run's execution data — the fields logs.cost and logs.trace_spans withhold never appear here
  readPausedExecution: defineWorkspaceOperation({
    id: 'workflows.paused_executions.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  /**
   * Downloading one file a run produced. Separate from `readRun` because it
   * hands out bytes and records a `FILE_DOWNLOADED` audit event, which reading
   * the run resource does not; it keeps `readRun`'s policy because the resource
   * being authorized is still the run — a run file is reachable only through
   * the run that recorded it, never as a standalone workspace file.
   *
   * `logs.trace_spans` is deliberately not a gate here, and the distinction is
   * the one that capability draws everywhere else: it withholds *fields* inside
   * a run, not the right to read one. `readRun` therefore withholds the file
   * *listing* from a viewer whose group hides execution data — the descriptors
   * are that data, and `includeFileBase64` is its bytes — while this operation,
   * which resolves one already-named file id, stays governed by workspace role.
   * A run file id exists nowhere but the execution data the same projection
   * withholds, so hiding the listing removes the way to name a file rather than
   * the right to fetch a named one.
   *
   * If that ever needs to become a refusal rather than a projection, it belongs
   * in `capability` on this operation, where the funnel applies it — not in a
   * check at one of the surfaces that reach it.
   */
  // permission-group-exempt: a run's own output bytes belong to the run its reader may already open; files.bulk_download withholds the workspace file store, and logs.trace_spans withholds the run's listed fields — including readRun's file list — not the right to fetch one named file
  downloadRunFile: defineWorkspaceOperation({
    id: 'workflows.download_run_file',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: stopping a run already in flight is governed by workspace role
  cancelRun: defineWorkspaceOperation({
    id: 'workflows.runs.cancel',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
  // permission-group-exempt: answering a paused run is governed by workspace role
  resumeRun: defineWorkspaceOperation({
    id: 'workflows.runs.resume',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'none',
    ...ALL_WORKFLOW_PRINCIPAL_POLICY,
  }),
} as const

export type WorkflowOperation = (typeof workflowOperations)[keyof typeof workflowOperations]
