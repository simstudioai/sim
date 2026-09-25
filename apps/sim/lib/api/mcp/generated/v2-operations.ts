/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted from the Zod route contracts in `apps/sim/lib/api/contracts/v2/**`
 * by `scripts/generate-v2-mcp-operations.ts`. Regenerate with
 * `bun run generate:mcp-operations`; CI fails when this file is stale.
 */

import {
  v2CancelOrganizationAccessRequestContract,
  v2CancelWorkspaceAccessRequestContract,
  v2CreateOrganizationAccessRequestContract,
  v2CreateWorkspaceAccessRequestContract,
  v2DiscoverOrganizationAccessRequestsContract,
  v2DiscoverWorkspaceAccessRequestsContract,
  v2GetOrganizationAccessRequestSettingsContract,
  v2ListMyOrganizationAccessRequestsContract,
  v2ListMyWorkspaceAccessRequestsContract,
  v2ListOrganizationAccessRequestsContract,
  v2PreviewOrganizationAccessRequestContract,
  v2ResolveOrganizationAccessRequestContract,
  v2UpdateOrganizationAccessRequestSettingsContract,
} from '@/lib/api/contracts/v2/access-requests'
import { v2GetAuditLogContract, v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import {
  v2GetBillingStatusContract,
  v2ListBillingLogsContract,
} from '@/lib/api/contracts/v2/billing'
import {
  v2ExecuteToolContract,
  v2GetBlockContract,
  v2GetToolContract,
  v2ListBlocksContract,
  v2ListConnectorTypesContract,
  v2ListToolsContract,
} from '@/lib/api/contracts/v2/catalog'
import { v2ChatContract } from '@/lib/api/contracts/v2/chat'
import {
  v2DeleteWorkflowChatDeploymentContract,
  v2GetWorkflowChatDeploymentContract,
  v2ListChatDeploymentsContract,
  v2ReplaceWorkflowChatDeploymentContract,
} from '@/lib/api/contracts/v2/chat-deployments'
import {
  v2CreateCredentialConnectionContract,
  v2CreateServiceAccountCredentialContract,
  v2DeleteCredentialContract,
  v2GetCredentialContract,
  v2ListCredentialProvidersContract,
  v2ListCredentialsContract,
  v2UpdateCredentialContract,
} from '@/lib/api/contracts/v2/credentials'
import {
  v2CreateCustomToolContract,
  v2DeleteCustomToolContract,
  v2GetCustomToolContract,
  v2ListCustomToolsContract,
  v2UpdateCustomToolContract,
} from '@/lib/api/contracts/v2/custom-tools'
import {
  v2DeleteFileVersionContract,
  v2GetFileVersionContract,
  v2ListFileVersionsContract,
  v2ReadFileVersionTextContract,
  v2RevertFileVersionContract,
} from '@/lib/api/contracts/v2/file-versions'
import {
  v2AbortFileUploadContract,
  v2BulkDeleteFilesContract,
  v2CompleteFileUploadContract,
  v2CreateFileContract,
  v2CreateFileFolderContract,
  v2CreateFileUploadContract,
  v2CreateFileUploadPartUrlsContract,
  v2DeleteFileContract,
  v2DeleteFileFolderContract,
  v2EditFileContentContract,
  v2GetFileContract,
  v2GetFileShareContract,
  v2GetFileUploadContract,
  v2ListFileFoldersContract,
  v2ListFilesContract,
  v2MoveFileItemsContract,
  v2ReadFileTextContract,
  v2RelocateFileFolderContract,
  v2RenameFileContract,
  v2RestoreFileContract,
  v2RestoreFileFolderContract,
  v2SearchFileContentContract,
  v2UnzipFileContract,
  v2UpdateFileContentContract,
  v2UpsertFileShareContract,
} from '@/lib/api/contracts/v2/files'
import {
  v2AbortKnowledgeDocumentUploadContract,
  v2AddWorkspaceFilesToKnowledgeBaseContract,
  v2BulkUpdateKnowledgeDocumentsContract,
  v2CompleteKnowledgeDocumentUploadContract,
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeConnectorContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadPartUrlsContract,
  v2CreateKnowledgeFolderContract,
  v2DeleteKnowledgeBaseContract,
  v2DeleteKnowledgeConnectorContract,
  v2DeleteKnowledgeDocumentContract,
  v2DeleteKnowledgeFolderContract,
  v2GetKnowledgeBaseContract,
  v2GetKnowledgeConnectorContract,
  v2GetKnowledgeDocumentContract,
  v2ListKnowledgeBasesContract,
  v2ListKnowledgeConnectorDocumentsContract,
  v2ListKnowledgeConnectorsContract,
  v2ListKnowledgeDocumentsContract,
  v2ListKnowledgeFoldersContract,
  v2ListKnowledgeTagsContract,
  v2RelocateKnowledgeFolderContract,
  v2RestoreKnowledgeBaseContract,
  v2SearchKnowledgeContract,
  v2SyncKnowledgeConnectorContract,
  v2UpdateKnowledgeBaseContract,
  v2UpdateKnowledgeConnectorContract,
  v2UpdateKnowledgeConnectorDocumentsContract,
  v2UpdateKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  v2BulkUpdateKnowledgeChunksContract,
  v2CreateKnowledgeChunkContract,
  v2DeleteKnowledgeChunkContract,
  v2GetKnowledgeChunkContract,
  v2ListKnowledgeChunksContract,
  v2UpdateKnowledgeChunkContract,
} from '@/lib/api/contracts/v2/knowledge-chunks'
import {
  v2BulkSaveKnowledgeTagDefinitionsContract,
  v2CreateKnowledgeTagContract,
  v2DeleteKnowledgeTagContract,
  v2DeleteKnowledgeTagDefinitionsContract,
  v2GetNextKnowledgeTagSlotContract,
  v2ListKnowledgeTagUsageContract,
  v2UpdateKnowledgeTagContract,
} from '@/lib/api/contracts/v2/knowledge-tags'
import { v2GetLogContract, v2ListLogsContract } from '@/lib/api/contracts/v2/logs'
import { v2GetLogStatsContract } from '@/lib/api/contracts/v2/logs-stats'
import {
  v2CreateMcpServerContract,
  v2DeleteMcpServerContract,
  v2GetMcpServerContract,
  v2ListMcpServersContract,
  v2ListMcpServerToolsContract,
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { v2GetMetaContract } from '@/lib/api/contracts/v2/meta'
import {
  v2GetOrganizationMemberUsageLimitContract,
  v2GetOrganizationUsageBreakdownContract,
  v2GetOrganizationUsageSummaryContract,
  v2ListOrganizationUsageEventsContract,
  v2UpdateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/v2/organization-usage'
import {
  v2CreateOrganizationInvitationContract,
  v2GetOrganizationContract,
  v2GetOrganizationInvitationContract,
  v2ListOrganizationInvitationsContract,
  v2ListOrganizationInvitationWorkspacesContract,
  v2ListOrganizationMembersContract,
  v2ListOrganizationsContract,
  v2ListOrganizationWorkspacesContract,
  v2RemoveOrganizationMemberContract,
  v2ResendOrganizationInvitationContract,
  v2RevokeOrganizationInvitationContract,
  v2UpdateOrganizationMemberContract,
} from '@/lib/api/contracts/v2/organizations'
import {
  v2AddPermissionGroupMemberContract,
  v2BulkAddPermissionGroupMembersContract,
  v2CreatePermissionGroupContract,
  v2DeletePermissionGroupContract,
  v2GetPermissionGroupContract,
  v2ListPermissionGroupMembersContract,
  v2ListPermissionGroupsContract,
  v2RemovePermissionGroupMemberContract,
  v2UpdatePermissionGroupContract,
} from '@/lib/api/contracts/v2/permission-groups'
import {
  v2CreateSandboxContract,
  v2DeleteSandboxContract,
  v2GetSandboxContract,
  v2ListSandboxesContract,
  v2UpdateSandboxContract,
} from '@/lib/api/contracts/v2/sandboxes'
import {
  v2DeleteSecretContract,
  v2ListSecretsContract,
  v2SetSecretContract,
} from '@/lib/api/contracts/v2/secrets'
import { v2GetSelectorContract, v2ListSelectorContract } from '@/lib/api/contracts/v2/selectors'
import {
  v2CreateSkillContract,
  v2DeleteSkillContract,
  v2GetSkillContract,
  v2GrantSkillEditorContract,
  v2ListSkillEditorsContract,
  v2ListSkillsContract,
  v2RevokeSkillEditorContract,
  v2UpdateSkillContract,
} from '@/lib/api/contracts/v2/skills'
import {
  v2AddTableColumnContract,
  v2AddWorkflowGroupContract,
  v2BulkDeleteTablesContract,
  v2BulkUpdateTableRowsContract,
  v2CancelTableDispatchContract,
  v2CancelTableExportContract,
  v2CancelTableImportContract,
  v2CancelTableRunsContract,
  v2CompleteTableImportContract,
  v2CreateTableContract,
  v2CreateTableDispatchContract,
  v2CreateTableExportContract,
  v2CreateTableFolderContract,
  v2CreateTableImportContract,
  v2CreateTableImportPartUrlsContract,
  v2CreateTableRowsContract,
  v2CreateTableViewContract,
  v2DeleteTableColumnContract,
  v2DeleteTableContract,
  v2DeleteTableFolderContract,
  v2DeleteTableRowContract,
  v2DeleteTableRowsContract,
  v2DeleteTableViewContract,
  v2DeleteWorkflowGroupContract,
  v2GetRowEnrichmentContract,
  v2GetTableContract,
  v2GetTableDispatchContract,
  v2GetTableExportContract,
  v2GetTableImportContract,
  v2GetTableRowContract,
  v2GetTableViewContract,
  v2ListTableDispatchesContract,
  v2ListTableFoldersContract,
  v2ListTableRowsContract,
  v2ListTablesContract,
  v2ListTableViewsContract,
  v2ListWorkflowGroupsContract,
  v2MoveTablesContract,
  v2QueryRowsContract,
  v2QueryRowsCountContract,
  v2RelocateTableFolderContract,
  v2RestoreTableContract,
  v2RestoreTableFolderContract,
  v2RunRowEnrichmentContract,
  v2SearchTableRowsContract,
  v2TableExportDownloadContract,
  v2UpdateRowsByFilterContract,
  v2UpdateTableColumnContract,
  v2UpdateTableContract,
  v2UpdateTableRowContract,
  v2UpdateTableViewContract,
  v2UpdateWorkflowGroupContract,
  v2UpsertTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import { v2InspectWorkflowContract } from '@/lib/api/contracts/v2/workflow-inspection'
import {
  v2CreateWorkflowMcpServerContract,
  v2DeleteWorkflowMcpServerContract,
  v2DeployWorkflowMcpToolContract,
  v2GetWorkflowMcpServerContract,
  v2ListWorkflowMcpServersContract,
  v2ListWorkflowMcpToolsContract,
  v2UndeployWorkflowMcpToolContract,
  v2UpdateWorkflowMcpServerContract,
} from '@/lib/api/contracts/v2/workflow-mcp-servers'
import {
  v2ActivateWorkflowVersionContract,
  v2ApplyWorkflowOperationsContract,
  v2ApplyWorkflowVariablesContract,
  v2CancelWorkflowRunContract,
  v2CreateWorkflowContract,
  v2CreateWorkflowFolderContract,
  v2DeleteWorkflowContract,
  v2DeleteWorkflowFolderContract,
  v2DeployWorkflowContract,
  v2DuplicateWorkflowContract,
  v2ExecuteWorkflowContract,
  v2ExportWorkflowContract,
  v2GetWorkflowContract,
  v2GetWorkflowDeploymentContract,
  v2GetWorkflowRunContract,
  v2GetWorkflowStateContract,
  v2GetWorkflowVersionContract,
  v2ImportWorkflowContract,
  v2ListWorkflowFoldersContract,
  v2ListWorkflowRunsContract,
  v2ListWorkflowsContract,
  v2ListWorkflowVersionsContract,
  v2MoveWorkflowsContract,
  v2PreviewWorkflowImportContract,
  v2PreviewWorkflowRunFromBlockContract,
  v2RelocateWorkflowFolderContract,
  v2ReplaceWorkflowStateContract,
  v2RestoreWorkflowContract,
  v2ResumeWorkflowContract,
  v2RevertWorkflowVersionContract,
  v2RollbackWorkflowContract,
  v2UndeployWorkflowContract,
  v2UpdateWorkflowContract,
  v2UpdateWorkflowPublicApiContract,
  v2UpdateWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import {
  v2ForkWorkspaceContract,
  v2GetWorkspaceForkAvailabilityContract,
  v2GetWorkspaceForkLineageContract,
  v2GetWorkspaceForkMappingsContract,
  v2ListWorkspaceForkChildrenContract,
  v2ListWorkspaceForkResourcesContract,
  v2PreviewWorkspaceForkContract,
  v2PreviewWorkspacePullContract,
  v2PreviewWorkspacePushContract,
  v2PullWorkspaceContract,
  v2PushWorkspaceContract,
  v2RollbackWorkspaceForkContract,
  v2UnlinkWorkspaceForkContract,
  v2UpdateWorkspaceForkExclusionsContract,
  v2UpdateWorkspaceForkMappingsContract,
} from '@/lib/api/contracts/v2/workspace-fork'
import { v2CreateWorkspaceInvitationsContract } from '@/lib/api/contracts/v2/workspace-invitations'
import {
  v2GetWorkspaceOperationContract,
  v2ListWorkspaceOperationsContract,
} from '@/lib/api/contracts/v2/workspace-operations'
import { v2GetWorkspacePermissionConfigContract } from '@/lib/api/contracts/v2/workspace-permissions'
import {
  v2GetWorkspaceContract,
  v2ListWorkspaceMembersContract,
  v2ListWorkspacesContract,
} from '@/lib/api/contracts/v2/workspaces'
import type { V2McpOperation } from '@/lib/api/mcp/types'

export const V2_MCP_OPERATIONS = {
  abortFileUpload: {
    contract: v2AbortFileUploadContract,
    summary: 'Abort File Upload',
    description:
      'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/route').then((route) => route.DELETE),
  },
  abortKnowledgeDocumentUpload: {
    contract: v2AbortKnowledgeDocumentUploadContract,
    summary: 'Abort Document Upload',
    description:
      'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/route').then(
        (route) => route.DELETE
      ),
  },
  activateWorkflowVersion: {
    contract: v2ActivateWorkflowVersionContract,
    summary: 'Activate Workflow Version',
    description:
      'Asynchronously activate a specific deployment version, including when the workflow is not currently deployed. The draft remains unchanged. Read Get Workflow Deployment for `isDeployed` and `latestDeploymentAttempt`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/activate/route').then(
        (route) => route.POST
      ),
  },
  addPermissionGroupMember: {
    contract: v2AddPermissionGroupMemberContract,
    summary: 'Add Permission Group Member',
    description:
      'Assign an organization member to a permission group. An existing assignment or membership in another group targeting the same workspace returns a conflict. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/route'
      ).then((route) => route.POST),
  },
  addTableColumn: {
    contract: v2AddTableColumnContract,
    summary: 'Add Column',
    description:
      'Add a typed column and return the complete resulting table schema.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.POST),
  },
  addWorkflowGroup: {
    contract: v2AddWorkflowGroupContract,
    summary: 'Add Workflow Group',
    description:
      'Bind a workflow or enrichment to the table and create the columns populated by its outputs. An output whose column the table already has attaches that column to the group instead of creating it, so `outputColumns` may be omitted when every output lands in an existing column.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.POST),
  },
  addWorkspaceFilesToKnowledgeBase: {
    contract: v2AddWorkspaceFilesToKnowledgeBaseContract,
    summary: 'Index Workspace Files',
    description:
      'Queue stored workspace files for indexing without re-uploading bytes. Unreadable, unsupported, or over-100 MB files appear in `failed`; valid files are queued. Partial success returns `200`. Use Get Document to poll processing after receiving document IDs. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files/route').then(
        (route) => route.POST
      ),
  },
  applyWorkflowOperations: {
    contract: v2ApplyWorkflowOperationsContract,
    summary: 'Apply Workflow Operations',
    description:
      'Edit the draft graph and block enablement in one write. Inspect `skipped` for failures; do not retry `deferred` edges. With `atomic=true`, skipped operations or dropped inputs return `409` (`OPERATIONS_NOT_APPLIED`) without saving. `mintedBlockIds` maps labels to generated IDs. Lint is advisory; `dryRun=true` validates without saving, auditing, or notifying. The live deployment is unchanged. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/operations/route').then((route) => route.POST),
  },
  applyWorkflowVariables: {
    contract: v2ApplyWorkflowVariablesContract,
    summary: 'Update Workflow Variables',
    description:
      'Add, edit, or delete variables by name, applying operations in order. Values are coerced to their declared type when possible; otherwise they are stored as supplied. A batch with no changes returns `200` with `changed: false`. Read current variables with Get Workflow.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/variables/route').then((route) => route.PATCH),
  },
  bulkAddPermissionGroupMembers: {
    contract: v2BulkAddPermissionGroupMembersContract,
    summary: 'Bulk Add Permission Group Members',
    description:
      'Assign up to 1000 selected organization members, or the entire organization roster, atomically. Existing assignments are skipped and users outside the organization are ignored. Any overlapping membership conflict rejects the entire batch. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/bulk/route'
      ).then((route) => route.POST),
  },
  bulkDeleteFiles: {
    contract: v2BulkDeleteFilesContract,
    summary: 'Delete Files',
    description:
      'Archive up to 1,000 workspace files while retaining their stored bytes. Use Restore File to recover each file.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/bulk-delete/route').then((route) => route.POST),
  },
  bulkDeleteTables: {
    contract: v2BulkDeleteTablesContract,
    summary: 'Bulk Delete Tables and Folders',
    description:
      'Archive up to 100 selected tables and folders, including folder contents. Items succeed or fail independently, with `skipped`, `notFound`, and `failed` outcomes. `deletedItems` includes all descendants. Use Restore Table or Restore Folder to recover archived items.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/bulk-delete/route').then((route) => route.POST),
  },
  bulkSaveKnowledgeTagDefinitions: {
    contract: v2BulkSaveKnowledgeTagDefinitionsContract,
    summary: 'Bulk Save Tag Definitions',
    description:
      'Create or update tag definitions, preserving unspecified slots. Updates require `originalDisplayName`; other entries create tags. Slot and name conflicts appear in per-definition `errors` with HTTP `200`, leaving conflicting values unchanged. Use Update Document to set tag values. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.PUT),
  },
  bulkUpdateKnowledgeChunks: {
    contract: v2BulkUpdateKnowledgeChunksContract,
    summary: 'Bulk Update Chunks',
    description:
      'Enable, disable, or delete multiple chunks in one best-effort request. Unknown chunk IDs appear in `errors` without failing the request; `processed` counts matched chunks, not changes. Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route').then(
        (route) => route.PATCH
      ),
  },
  bulkUpdateKnowledgeDocuments: {
    contract: v2BulkUpdateKnowledgeDocumentsContract,
    summary: 'Bulk Enable or Disable Documents',
    description:
      'Enable or disable selected documents, or use `selectAll` for the entire knowledge base. Use Delete Document to remove documents individually. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route').then(
        (route) => route.PATCH
      ),
  },
  bulkUpdateTableRows: {
    contract: v2BulkUpdateTableRowsContract,
    summary: 'Bulk Update Rows',
    description:
      'Apply separate partial patches to up to 1,000 rows, preserving omitted columns. A row outside the table rejects the entire request with `400` and lists missing IDs. Use Update Rows by Filter to apply one patch to every matching row.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/bulk-update/route').then((route) => route.POST),
  },
  cancelOrganizationAccessRequest: {
    contract: v2CancelOrganizationAccessRequestContract,
    summary: 'Cancel Organization Access Request',
    description:
      'Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/cancel/route'
      ).then((route) => route.POST),
  },
  cancelTableDispatch: {
    contract: v2CancelTableDispatchContract,
    summary: 'Cancel Run Dispatch',
    description:
      'Stop a dispatch from scheduling more cells. Already queued or running cells continue; use Cancel Column Runs to stop them. Completed or canceled dispatches return unchanged.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route').then(
        (route) => route.DELETE
      ),
  },
  cancelTableExport: {
    contract: v2CancelTableExportContract,
    summary: 'Cancel Table Export',
    description: 'Cancel an export that is still in progress.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/route').then(
        (route) => route.DELETE
      ),
  },
  cancelTableImport: {
    contract: v2CancelTableImportContract,
    summary: 'Cancel Table Import',
    description:
      'Cancel an upload or processing import. Committed row batches remain. Non-cancelable states, including `expired`, return `409`; unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/route').then((route) => route.DELETE),
  },
  cancelTableRuns: {
    contract: v2CancelTableRunsContract,
    summary: 'Cancel Column Runs',
    description:
      'Stop in-flight and pending workflow or enrichment cell runs across the table or one selected row.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/cancel-runs/route').then((route) => route.POST),
  },
  cancelWorkflowRun: {
    contract: v2CancelWorkflowRunContract,
    summary: 'Cancel Workflow Run',
    description:
      'Request cancellation of a running, queued, or paused workflow run. Cancelling a run already in a terminal state is a `200` no-op answered with `success: false` and an `already_*` reason. A run produced by a table workflow group is a `409` when its cell can no longer accept the cancellation.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route').then(
        (route) => route.POST
      ),
  },
  cancelWorkspaceAccessRequest: {
    contract: v2CancelWorkspaceAccessRequestContract,
    summary: 'Cancel Workspace Access Request',
    description:
      'Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/access-requests/[requestId]/cancel/route').then(
        (route) => route.POST
      ),
  },
  chat: {
    contract: v2ChatContract,
    handler: () => import('@/app/api/v2/chat/route').then((route) => route.POST),
  },
  completeFileUpload: {
    contract: v2CompleteFileUploadContract,
    summary: 'Complete File Upload',
    description:
      'Finalize an upload and register its workspace file. Repeating a completed upload returns the existing file.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/complete/route').then((route) => route.POST),
  },
  completeKnowledgeDocumentUpload: {
    contract: v2CompleteKnowledgeDocumentUploadContract,
    summary: 'Complete Document Upload',
    description:
      'Verify a direct upload or assemble multipart parts, create the knowledge document, and queue asynchronous processing.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'
      ).then((route) => route.POST),
  },
  completeTableImport: {
    contract: v2CompleteTableImportContract,
    summary: 'Complete Table Import Upload',
    description:
      'Verify or assemble uploaded CSV bytes and start processing under the same import ID. Requires an import awaiting upload completion; other states return `409`. Unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/complete/route').then((route) => route.POST),
  },
  createCredentialConnection: {
    contract: v2CreateCredentialConnectionContract,
    summary: 'Create Credential Connection',
    description:
      'Create a short-lived browser URL for connecting an OAuth provider or reconnecting an existing OAuth credential. Open the URL, sign in as the authenticated user, complete provider authorization, then refresh the credentials list. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/credentials/connections/route').then((route) => route.POST),
  },
  createCustomTool: {
    contract: v2CreateCustomToolContract,
    summary: 'Create Custom Tool',
    description:
      'Create a code-backed custom tool in a workspace. Its title must be unique because tools resolve by title at call time.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/custom-tools/route').then((route) => route.POST),
  },
  createFile: {
    contract: v2CreateFileContract,
    summary: 'Create File',
    description:
      'Create a workspace file from inline UTF-8 or base64 content. Use an upload session for streamed or larger files.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/route').then((route) => route.POST),
  },
  createFileFolder: {
    contract: v2CreateFileFolderContract,
    summary: 'Create Folder',
    description: 'Create a folder at the supplied workspace path.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.POST),
  },
  createFileUpload: {
    contract: v2CreateFileUploadContract,
    summary: 'Create File Upload',
    description:
      'Create a resumable upload session and receive either a signed PUT URL or multipart instructions.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/uploads/route').then((route) => route.POST),
  },
  createFileUploadPartUrls: {
    contract: v2CreateFileUploadPartUrlsContract,
    summary: 'Create File Upload Part URLs',
    description:
      'Create signed URLs for a bounded set of multipart upload part numbers.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/parts/route').then((route) => route.POST),
  },
  createKnowledgeBase: {
    contract: v2CreateKnowledgeBaseContract,
    summary: 'Create Knowledge Base',
    description:
      'Create a knowledge base in a workspace with optional folder placement and chunking configuration. An unknown `folderPath` returns `404`. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/route').then((route) => route.POST),
  },
  createKnowledgeChunk: {
    contract: v2CreateKnowledgeChunkContract,
    summary: 'Create Chunk',
    description:
      'Append a chunk, embedding it before the response so it is immediately searchable. It inherits the document\'s tags and next `chunkIndex`. Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route').then(
        (route) => route.POST
      ),
  },
  createKnowledgeConnector: {
    contract: v2CreateKnowledgeConnectorContract,
    summary: 'Create Knowledge Connector',
    description:
      'Validate and connect an external source, then queue its initial synchronization. The `apiKey` field is never returned. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/route').then(
        (route) => route.POST
      ),
  },
  createKnowledgeDocumentUpload: {
    contract: v2CreateKnowledgeDocumentUploadContract,
    summary: 'Create Document Upload',
    description:
      'Create a resumable upload session and receive direct PUT or multipart transfer instructions.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route').then(
        (route) => route.POST
      ),
  },
  createKnowledgeDocumentUploadPartUrls: {
    contract: v2CreateKnowledgeDocumentUploadPartUrlsContract,
    summary: 'Create Document Upload Part URLs',
    description:
      'Create short-lived signed PUT URLs for up to 100 multipart part numbers.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts/route'
      ).then((route) => route.POST),
  },
  createKnowledgeFolder: {
    contract: v2CreateKnowledgeFolderContract,
    summary: 'Create Folder',
    description:
      'Create a folder in the knowledge-base folder tree. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.POST),
  },
  createKnowledgeTag: {
    contract: v2CreateKnowledgeTagContract,
    summary: 'Create Tag',
    description:
      'Create a tag definition. Write document values by `tagSlot` and filter by `displayName`. Omitting `tagSlot` selects a free slot; exhaustion returns `400`. An occupied slot or duplicate name returns `409`. Use Bulk Save Tag Definitions for multiple definitions. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.POST),
  },
  createMcpServer: {
    contract: v2CreateMcpServerContract,
    summary: 'Create MCP Server',
    description:
      'Register an external MCP server without connecting to it. A duplicate URL returns `409`; use Update MCP Server to change the existing registration. The server remains disconnected until List MCP Server Tools succeeds.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/mcp-servers/route').then((route) => route.POST),
  },
  createOrganizationAccessRequest: {
    contract: v2CreateOrganizationAccessRequestContract,
    summary: 'Create Organization Access Request',
    description:
      'Request access for the acting user using a target from discovery. Returns an existing matching pending request when applicable; the result may be closed if access is already available. Permission approvals change the governing group for all affected members. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/route').then(
        (route) => route.POST
      ),
  },
  createOrganizationInvitation: {
    contract: v2CreateOrganizationInvitationContract,
    summary: 'Create Organization Invitation',
    description:
      'Email an invitation to join the organization as a member or administrator. Requires organization administrator access, invitations enabled, and an available seat on an eligible plan. This grants no workspace-specific permissions. An unexpired pending invitation for the email conflicts; use Resend Organization Invitation to send it again. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/route').then(
        (route) => route.POST
      ),
  },
  createPermissionGroup: {
    contract: v2CreatePermissionGroupContract,
    summary: 'Create Permission Group',
    description:
      'Create a permission group. A non-default group requires workspaces and initially governs everyone in them. Creating a default group demotes the previous default to an inactive group until it is assigned workspaces. Overlapping all-member scopes conflict. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/route').then(
        (route) => route.POST
      ),
  },
  createSandbox: {
    contract: v2CreateSandboxContract,
    summary: 'Create Sandbox',
    description:
      'Create a uniquely named dependency environment. If a build is needed, track readiness with `buildStatus`; null means no build is required. Invalid dependencies return `400` with field details. Requires workspace admin access on Max or Enterprise. Creates and updates share a rate limit; respect `Retry-After`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/route').then((route) => route.POST),
  },
  createServiceAccountCredential: {
    contract: v2CreateServiceAccountCredentialContract,
    summary: 'Create Service-Account Credential',
    description:
      'Verify and store a service-account credential using the fields from List Credential Providers, encoded as a JSON object string in `credentials`. Secrets are never returned. A matching source returns the existing credential with `200`; creation returns `201`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/credentials/route').then((route) => route.POST),
  },
  createSkill: {
    contract: v2CreateSkillContract,
    summary: 'Create Skill',
    description:
      'Create one skill in a workspace. Its kebab-case name must be unique and cannot be reserved by a built-in skill. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/route').then((route) => route.POST),
  },
  createTable: {
    contract: v2CreateTableContract,
    summary: 'Create Table',
    description:
      'Create a table with a typed column schema and optional folder placement.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/route').then((route) => route.POST),
  },
  createTableDispatch: {
    contract: v2CreateTableDispatchContract,
    summary: 'Create Run Dispatch',
    description:
      'Start workflow or enrichment groups across all rows or selected rows. Poll Get Run Dispatch until `complete` or `canceled`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`. Use Cancel Run Dispatch to stop further scheduling.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/route').then((route) => route.POST),
  },
  createTableExport: {
    contract: v2CreateTableExportContract,
    summary: 'Create Table Export',
    description:
      'Create a CSV or JSON export. Exports of small tables finish during the request; larger exports run asynchronously.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/route').then((route) => route.POST),
  },
  createTableFolder: {
    contract: v2CreateTableFolderContract,
    summary: 'Create Folder',
    description:
      'Create one table-folder leaf whose parent path already exists.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.POST),
  },
  createTableImport: {
    contract: v2CreateTableImportContract,
    summary: 'Create Table Import',
    description:
      'Create a CSV import. Upload sources receive signed transfer instructions; workspace-file sources start processing directly.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/imports/route').then((route) => route.POST),
  },
  createTableImportPartUrls: {
    contract: v2CreateTableImportPartUrlsContract,
    summary: 'Create Table Import Part URLs',
    description:
      'Create signed URLs for multipart upload parts. Requires the `uploading` state; other states return `409`. Unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/parts/route').then((route) => route.POST),
  },
  createTableRows: {
    contract: v2CreateTableRowsContract,
    summary: 'Create Rows',
    description:
      'Insert one row with a data object or insert a bounded batch with a rows array. Cell keys are column names.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.POST),
  },
  createTableView: {
    contract: v2CreateTableViewContract,
    summary: 'Create View',
    description:
      'Save a filter, sort, and column layout as a named presentation of a table.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/views/route').then((route) => route.POST),
  },
  createWorkflow: {
    contract: v2CreateWorkflowContract,
    summary: 'Create Workflow',
    description:
      'Create a workflow at the workspace root or in a workflow folder. The response includes seeded blocks and their IDs for attaching edges. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/route').then((route) => route.POST),
  },
  createWorkflowFolder: {
    contract: v2CreateWorkflowFolderContract,
    summary: 'Create Workflow Folder',
    description:
      'Create a workflow folder in a workspace. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.POST),
  },
  createWorkflowMcpServer: {
    contract: v2CreateWorkflowMcpServerContract,
    summary: 'Create Workflow MCP Server',
    description:
      'Create an MCP server that exposes deployed workflows as tools. Every supplied workflow must already be deployed. With `isPublic: true`, anyone with the server URL can execute its workflows without a Sim API key. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/workflow-mcp-servers/route').then((route) => route.POST),
  },
  createWorkspaceAccessRequest: {
    contract: v2CreateWorkspaceAccessRequestContract,
    summary: 'Create Workspace Access Request',
    description:
      'Request access for the acting user using a target from discovery. Returns an existing matching pending request when applicable; the result may be closed if access is already available. Permission approvals change the governing group for all affected members. Requires access to the workspace; external collaborators use their workspace grant. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/access-requests/route').then(
        (route) => route.POST
      ),
  },
  createWorkspaceInvitations: {
    contract: v2CreateWorkspaceInvitationsContract,
    summary: 'Create Workspace Invitations',
    description:
      'Invite people to a workspace or grant access immediately to existing organization members. Requires workspace administrator access and current invitation eligibility; organization administrator invitations also require organization administrator access. Recipients are processed independently: inspect failed even after HTTP 200, and inspect invitation status before retrying a delivery failure. Existing access is preserved. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/invitations/route').then((route) => route.POST),
  },
  deleteCredential: {
    contract: v2DeleteCredentialContract,
    summary: 'Disconnect Credential',
    description:
      'Disconnect an OAuth or service-account credential and clear its stored workflow, deployment, paused-run, knowledge-connector, and webhook references. Credential admin access is required. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/route').then((route) => route.DELETE),
  },
  deleteCustomTool: {
    contract: v2DeleteCustomToolContract,
    summary: 'Delete Custom Tool',
    description:
      'Delete a custom tool. Agent blocks retain their configuration but can no longer call the deleted tool.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.DELETE),
  },
  deleteFile: {
    contract: v2DeleteFileContract,
    summary: 'Delete File',
    description:
      'Archive a workspace file, retaining its stored bytes and removing API read access. List Files with `scope=archived` finds it; Restore File recovers it. Archiving an already archived file returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/route').then((route) => route.DELETE),
  },
  deleteFileFolder: {
    contract: v2DeleteFileFolderContract,
    summary: 'Delete Folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its files and subfolders. Use Restore Folder to recover the archived contents.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.DELETE),
  },
  deleteFileVersion: {
    contract: v2DeleteFileVersionContract,
    summary: 'Delete File Version',
    description:
      'Permanently delete one earlier version and its stored content, for example to purge a leaked value from history before retention removes it. The current version returns `409`; revert to another version first. A version that does not exist returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/route').then((route) => route.DELETE),
  },
  deleteKnowledgeBase: {
    contract: v2DeleteKnowledgeBaseContract,
    summary: 'Delete Knowledge Base',
    description:
      'Archive a knowledge base, its documents, and its connectors, pausing synchronization. Use List Knowledge Bases with `scope=archived` to find it and Restore Knowledge Base to recover it.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.DELETE),
  },
  deleteKnowledgeChunk: {
    contract: v2DeleteKnowledgeChunkContract,
    summary: 'Delete Chunk',
    description:
      'Permanently remove one chunk and subtract it from document counts. Remaining `chunkIndex` values stay stable and may become non-contiguous. Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document. Documents that have not finished processing return `409` with their current status. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]/route'
      ).then((route) => route.DELETE),
  },
  deleteKnowledgeConnector: {
    contract: v2DeleteKnowledgeConnectorContract,
    summary: 'Delete Knowledge Connector',
    description:
      'Delete a connector and optionally its synchronized documents. Documents are retained by default. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteKnowledgeDocument: {
    contract: v2DeleteKnowledgeDocumentContract,
    summary: 'Delete Document',
    description:
      'Remove a document from listings and search. Uploaded documents and their chunks are deleted. Connector documents are excluded while retaining their stored data; later synchronization does not re-add them.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteKnowledgeFolder: {
    contract: v2DeleteKnowledgeFolderContract,
    summary: 'Delete Folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its subfolders and knowledge bases. Use Restore Knowledge Base to recover knowledge bases.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.DELETE),
  },
  deleteKnowledgeTag: {
    contract: v2DeleteKnowledgeTagContract,
    summary: 'Delete Tag',
    description:
      'Permanently delete a tag definition and its values from every document and chunk in the knowledge base. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteKnowledgeTagDefinitions: {
    contract: v2DeleteKnowledgeTagDefinitionsContract,
    summary: 'Delete Tag Definitions',
    description:
      'Delete unused tag definitions by default. With `unused=false`, permanently delete all definitions and their values from documents and chunks. Use Delete Tag to remove one definition. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.DELETE),
  },
  deleteMcpServer: {
    contract: v2DeleteMcpServerContract,
    summary: 'Delete MCP Server',
    description:
      "Remove an MCP server and revoke its OAuth tokens. Workflows retain blocks that referenced the server's tools, but those tools can no longer be called.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.DELETE),
  },
  deletePermissionGroup: {
    contract: v2DeletePermissionGroupContract,
    summary: 'Delete Permission Group',
    description:
      'Permanently delete a permission group and its membership assignments. Members then inherit any other applicable restrictions. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteSandbox: {
    contract: v2DeleteSandboxContract,
    summary: 'Delete Sandbox',
    description:
      'Delete a sandbox. Function blocks using it fail until reconfigured. Requires workspace admin access on Max or Enterprise. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.DELETE),
  },
  deleteSecret: {
    contract: v2DeleteSecretContract,
    summary: 'Delete Secret',
    description:
      'Delete a workspace or caller-owned personal secret without reading or returning its stored value. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/[name]/route').then((route) => route.DELETE),
  },
  deleteSkill: {
    contract: v2DeleteSkillContract,
    summary: 'Delete Skill',
    description:
      'Delete a workspace skill. Built-in skills are read-only and cannot be deleted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.DELETE),
  },
  deleteTable: {
    contract: v2DeleteTableContract,
    summary: 'Delete Table',
    description:
      'Archive a table while retaining its rows. Use List Tables with `scope=archived` to find it and Restore Table to recover it.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.DELETE),
  },
  deleteTableColumn: {
    contract: v2DeleteTableColumnContract,
    summary: 'Delete Column',
    description:
      'Delete a column by name while preserving at least one table column.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.DELETE),
  },
  deleteTableFolder: {
    contract: v2DeleteTableFolderContract,
    summary: 'Delete Folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its tables and subfolders. Use Restore Folder to recover the archived contents.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.DELETE),
  },
  deleteTableRow: {
    contract: v2DeleteTableRowContract,
    summary: 'Delete Row',
    description: 'Delete one row by identifier.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.DELETE),
  },
  deleteTableRows: {
    contract: v2DeleteTableRowsContract,
    summary: 'Delete Rows',
    description:
      'Delete rows by a non-empty predicate or an explicit bounded list of row identifiers.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.DELETE),
  },
  deleteTableView: {
    contract: v2DeleteTableViewContract,
    summary: 'Delete View',
    description:
      'Delete a saved presentation without changing any table rows.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.DELETE),
  },
  deleteWorkflow: {
    contract: v2DeleteWorkflowContract,
    summary: 'Delete Workflow',
    description:
      'Archive a workflow and stop its schedules, webhooks, MCP tools, and chats. Use List Workflows with `scope=archived` to find it and Restore Workflow to recover it and its archived resources. Both `deleted` and `archived` acknowledge archival.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.DELETE),
  },
  deleteWorkflowChatDeployment: {
    contract: v2DeleteWorkflowChatDeploymentContract,
    summary: 'Delete Workflow Chat Deployment',
    description:
      "Remove a workflow's hosted chat and release its URL identifier. The workflow API deployment remains active; use Undeploy Workflow to stop it. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.DELETE
      ),
  },
  deleteWorkflowFolder: {
    contract: v2DeleteWorkflowFolderContract,
    summary: 'Delete Workflow Folder',
    description:
      'Archive an empty workflow folder, or set `recursive=true` to archive its subfolders and workflows. Use Restore Workflow to recover workflows.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.DELETE),
  },
  deleteWorkflowGroup: {
    contract: v2DeleteWorkflowGroupContract,
    summary: 'Delete Workflow Group',
    description:
      'Delete a workflow group and every table column populated by that group.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.DELETE),
  },
  deleteWorkflowMcpServer: {
    contract: v2DeleteWorkflowMcpServerContract,
    summary: 'Delete Workflow MCP Server',
    description:
      'Delete a workflow MCP server and stop serving its tools. The underlying workflows remain deployed and executable through the workflow API. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.DELETE),
  },
  deployWorkflow: {
    contract: v2DeployWorkflowContract,
    summary: 'Deploy Workflow',
    description:
      'Create and asynchronously activate a deployment version. Every call creates a new version; retrying after a timeout can create a duplicate. Read Get Workflow Deployment to check activation. A conflicting webhook path returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deploy/route').then((route) => route.POST),
  },
  deployWorkflowMcpTool: {
    contract: v2DeployWorkflowMcpToolContract,
    summary: 'Publish Workflow As MCP Tool',
    description:
      'Publish a deployed workflow as an MCP tool using its deployed input schema. Each server has at most one tool per workflow; repeating the call replaces that tool and returns `200` with `updated: true`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route').then(
        (route) => route.POST
      ),
  },
  discoverOrganizationAccessRequests: {
    contract: v2DiscoverOrganizationAccessRequestsContract,
    summary: 'Discover Organization Access Requests',
    description:
      'Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/discovery/route').then(
        (route) => route.GET
      ),
  },
  discoverWorkspaceAccessRequests: {
    contract: v2DiscoverWorkspaceAccessRequestsContract,
    summary: 'Discover Workspace Access Requests',
    description:
      'Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/access-requests/discovery/route').then(
        (route) => route.GET
      ),
  },
  duplicateWorkflow: {
    contract: v2DuplicateWorkflowContract,
    summary: 'Duplicate Workflow',
    description:
      "Copy a workflow's graph and variables into the same workspace. Omit `name` to reuse the source name; name collisions in the destination folder are resolved automatically. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/duplicate/route').then((route) => route.POST),
  },
  editFileContent: {
    contract: v2EditFileContentContract,
    summary: 'Edit File Content',
    description:
      'Edit part of a UTF-8 file; use Replace File Content to replace it entirely. Search-and-replace requires one exact match unless `replaceAll` is true. Anchored modes match trimmed complete lines; their input descriptions specify boundary handling. Non-UTF-8 files return `400`. Concurrent writes return `409`; re-read before retrying.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/content/route').then((route) => route.PATCH),
  },
  executeTool: {
    contract: v2ExecuteToolContract,
    summary: 'Run Tool',
    description:
      'Run a built-in tool using published parameters and caller-owned credentials. Whole-value `{{VAR_NAME}}` references resolve for `user-only` parameters. Provider refusal returns `200` with `status: "failed"`; API failures use the error envelope. Hidden tools return `404`; blocked integrations return `403` with `error.details.code: INTEGRATION_NOT_ALLOWED`. Hosted-key use and measured Function sandbox costs are billed to the workspace. Function usage-limit checks can refuse execution with `402 USAGE_LIMIT_EXCEEDED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/tools/[toolId]/execute/route').then((route) => route.POST),
  },
  executeWorkflow: {
    contract: v2ExecuteWorkflowContract,
    summary: 'Execute Workflow',
    description:
      'Execute a deployment or use `run.source: "manual"` for the draft. Manual runs require personal or OAuth write access and reject async. Public deployments allow anonymous sync or streaming. Request `application/x-ndjson` for heartbeats and the final result. Timeouts return `200` with failed status and `TIMEOUT`. Supply `X-Run-Id` to prevent duplicate execution; reuse returns `409`, never a replay. Input descriptions specify compatible modes; invalid combinations return `400`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/execute/route').then((route) => route.POST),
  },
  exportWorkflow: {
    contract: v2ExportWorkflowContract,
    summary: 'Export Workflow',
    description:
      'Export a portable, secret-sanitized workflow. Use includeReferences=true for non-secret source identities and field occurrences used by mapped imports. Use includeWorkspaceBindings=true to retain non-secret workspace bindings for a same-workspace round trip; default exports clear those bindings. Credentials and secrets are cleared either way. Exporting records an audit event. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/export/route').then((route) => route.GET),
  },
  forkWorkspace: {
    contract: v2ForkWorkspaceContract,
    summary: 'Fork Workspace',
    description:
      'Create a child workspace with undeployed workflow drafts. Requires the reviewed preview fingerprint and a stable request ID. Identical retries return the same operation; reuse with different inputs returns 409. Poll Get Workspace Operation until selected resource copies complete. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/route').then((route) => route.POST),
  },
  getAuditLog: {
    contract: v2GetAuditLogContract,
    summary: 'Get Audit Log',
    description:
      'Get one organization audit-log entry. Requires an Enterprise subscription and organization admin or owner access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/audit-logs/[auditLogId]/route').then((route) => route.GET),
  },
  getBillingStatus: {
    contract: v2GetBillingStatusContract,
    summary: 'Get Billing Status',
    description:
      "Get the current plan, billing standing, credit allowance, and storage quota. Pooled `credits` and `storage` are visible only to callers who can manage the payer's billing; workspace API keys receive null for both. Use List Billing Logs for credit history.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/billing/status/route').then((route) => route.GET),
  },
  getBlock: {
    contract: v2GetBlockContract,
    summary: 'Get Block',
    description:
      "Get a block's fields, conditions, operations, tool schemas, and triggers. Unversioned types resolve to the newest visible version; the returned `id` identifies that version. Hidden or missing blocks return `404`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/blocks/[blockId]/route').then((route) => route.GET),
  },
  getCredential: {
    contract: v2GetCredentialContract,
    summary: 'Inspect Credential',
    description:
      "Inspect one selected connection's stored provider identity, recorded OAuth scopes, and access limitations. This does not decrypt secrets, contact the provider, or verify live resource access. Custom bot identities/scopes may be unknown. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/route').then((route) => route.GET),
  },
  getCustomTool: {
    contract: v2GetCustomToolContract,
    summary: 'Get Custom Tool',
    description:
      'Get one custom tool by identifier, scoped to its workspace.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.GET),
  },
  getFile: {
    contract: v2GetFileContract,
    summary: 'Get File Metadata',
    description:
      'Get file metadata, its public-share configuration, and the version number of its current content. The `share` field is null when the file has never been shared. `currentVersion` identifies the content in List File Versions and is the precondition Revert File Version accepts.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/metadata/route').then((route) => route.GET),
  },
  getFileShare: {
    contract: v2GetFileShareContract,
    summary: 'Get File Share',
    description:
      "Get a file's public-share configuration. An unshared file returns `data: null`; a disabled share returns its configuration with `isActive: false`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/files/[fileId]/share/route').then((route) => route.GET),
  },
  getFileUpload: {
    contract: v2GetFileUploadContract,
    summary: 'Get File Upload',
    description:
      "Get an upload session's state to determine whether an interrupted transfer can resume. Requires the signed upload token and current workspace access.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/files/uploads/[uploadId]/route').then((route) => route.GET),
  },
  getFileVersion: {
    contract: v2GetFileVersionContract,
    summary: 'Get File Version',
    description:
      'Get one version of a file. A version removed by retention, or one that never existed, returns `404`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/route').then((route) => route.GET),
  },
  getKnowledgeBase: {
    contract: v2GetKnowledgeBaseContract,
    summary: 'Get Knowledge Base',
    description:
      "Get a knowledge base's metadata and document counts. Inaccessible knowledge bases return `404`. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.GET),
  },
  getKnowledgeChunk: {
    contract: v2GetKnowledgeChunkContract,
    summary: 'Get Chunk',
    description:
      'Get one chunk of a document, including the exact text that was embedded. Documents that have not finished processing return `409` with their current status. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]/route'
      ).then((route) => route.GET),
  },
  getKnowledgeConnector: {
    contract: v2GetKnowledgeConnectorContract,
    summary: 'Get Knowledge Connector',
    description:
      'Get one connector and its ten most recent synchronization attempts. Stored API keys are never returned. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route').then(
        (route) => route.GET
      ),
  },
  getKnowledgeDocument: {
    contract: v2GetKnowledgeDocumentContract,
    summary: 'Get Document',
    description:
      'Get document metadata, processing status, and source connector details.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.GET
      ),
  },
  getLog: {
    contract: v2GetLogContract,
    summary: 'Get Log',
    description:
      "Get a run's workflow graph, trace spans, final output, and cost. Trace spans expire separately, so an empty `traceSpans` array does not prove none were recorded. Expired runs are permanently deleted. Retention is 30 days from run start on Free, unlimited on Pro and Team, and configured per organization on Enterprise with workspace overrides. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/logs/[runId]/route').then((route) => route.GET),
  },
  getLogStats: {
    contract: v2GetLogStatsContract,
    summary: 'Get Log Statistics',
    description:
      'Get bucketed run counts, success rate, errors, and mean latency for the workspace and individual workflows. Query fields describe window selection and bucketing. Folder filters cover subtrees. Expired runs are permanently deleted. Retention is 30 days from run start on Free, unlimited on Pro and Team, and configured per organization on Enterprise with workspace overrides. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/logs/stats/route').then((route) => route.GET),
  },
  getMcpServer: {
    contract: v2GetMcpServerContract,
    summary: 'Get MCP Server',
    description:
      'Get one MCP server by identifier. Request-header values and OAuth client secrets are never returned.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.GET),
  },
  getMeta: {
    contract: v2GetMetaContract,
    summary: 'Get API Capabilities',
    description:
      'Get whether v2 is available, what kind of API credential is calling, and when it expires. Requires a valid API key or OAuth access token.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/meta/route').then((route) => route.GET),
  },
  getNextKnowledgeTagSlot: {
    contract: v2GetNextKnowledgeTagSlotContract,
    summary: 'Get Next Tag Slot',
    description:
      'Get the next available slot and remaining capacity for a field type. This does not reserve a slot. Create Tag selects a free slot when `tagSlot` is omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot/route').then(
        (route) => route.GET
      ),
  },
  getOrganization: {
    contract: v2GetOrganizationContract,
    summary: 'Get Organization',
    description:
      'Get organization metadata and the acting user’s organization role. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/route').then((route) => route.GET),
  },
  getOrganizationAccessRequestSettings: {
    contract: v2GetOrganizationAccessRequestSettingsContract,
    summary: 'Get Organization Access Request Settings',
    description:
      'Get whether the organization allows new access requests and approvals. This preference does not enable features unavailable in the deployment or subscription. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/settings/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationInvitation: {
    contract: v2GetOrganizationInvitationContract,
    summary: 'Get Organization Invitation',
    description:
      'Get an invitation owned by the organization. Requires organization administrator access. Use List Organization Invitation Workspaces to inspect its workspace grants. The response excludes the acceptance token. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationMemberUsageLimit: {
    contract: v2GetOrganizationMemberUsageLimitContract,
    summary: 'Get Organization Member Credit Limit',
    description:
      'Read a person’s credit cap and credits consumed in the organization billing period. Hosted only. The userId identifies an organization member or external collaborator with workspace access in this organization; it is not a membership record ID. Null means no per-person cap, while organization limits still apply. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/usage-limit/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationUsageBreakdown: {
    contract: v2GetOrganizationUsageBreakdownContract,
    summary: 'Get Organization Usage Breakdown',
    description:
      'Read ranked organization usage by member, workspace, workflow, model, BYOK provider, or source. Requires organization administrator access and Usage Monitoring. Omitted usage is summarized in other. BYOK ranks tokens; other dimensions rank cost. More than 10,000 underlying groups returns 413; narrow the window or workspace. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/breakdown/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationUsageSummary: {
    contract: v2GetOrganizationUsageSummaryContract,
    summary: 'Get Organization Usage Summary',
    description:
      'Read pooled credits, a usage series, and an exact previous-period comparison when available. Requires organization administrator access and Usage Monitoring (Enterprise on hosted; enabled on self-hosted). Defaults to 30 days. Custom dates include both dates in the selected timezone and cannot exceed 92 days. Billing windows exceeding 366 days are rejected. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/summary/route').then(
        (route) => route.GET
      ),
  },
  getPermissionGroup: {
    contract: v2GetPermissionGroupContract,
    summary: 'Get Permission Group',
    description:
      'Get a permission group and its resolved restrictions. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.GET
      ),
  },
  getRowEnrichment: {
    contract: v2GetRowEnrichmentContract,
    summary: 'Get Row Group Run',
    description:
      'Read a workflow or enrichment group’s outcome for one row: `runState` (as exposed by `includeRunState`), output cells keyed by column name, and enrichment providers in cascade order with status, hosted-key cost, duration, and the matching provider. Existing rows always answer: `runState: null` means never run; `cascade: null` means no breakdown recorded. Missing tables, rows, or groups return `404`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route').then(
        (route) => route.GET
      ),
  },
  getSandbox: {
    contract: v2GetSandboxContract,
    summary: 'Get Sandbox',
    description:
      'Get one sandbox by identifier, scoped to its workspace, including its current build state and any build failure.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.GET),
  },
  getSelector: {
    contract: v2GetSelectorContract,
    summary: 'Get Selector Option',
    description:
      'Resolve a workspace configuration option by its provider identifier and declared dependencies. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/selectors/get/route').then((route) => route.POST),
  },
  getSkill: {
    contract: v2GetSkillContract,
    summary: 'Get Skill',
    description:
      'Get one workspace or built-in skill, including its full content. Built-in skills are marked read-only.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.GET),
  },
  getTable: {
    contract: v2GetTableContract,
    summary: 'Get Table',
    description:
      'Get a table with its metadata, column schema, locks, and current job. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.GET),
  },
  getTableDispatch: {
    contract: v2GetTableDispatchContract,
    summary: 'Get Run Dispatch',
    description:
      "Get a dispatch's current state. Poll until `complete` or `canceled`; use row reads with `includeRunState` for per-cell outcomes.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route').then(
        (route) => route.GET
      ),
  },
  getTableExport: {
    contract: v2GetTableExportContract,
    summary: 'Get Table Export',
    description: "Get a table export's progress and status.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/route').then((route) => route.GET),
  },
  getTableImport: {
    contract: v2GetTableImportContract,
    summary: 'Get Table Import',
    description:
      "Get an import's progress and status. During `uploading`, the signed upload token is required; omitting it returns `404`.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/route').then((route) => route.GET),
  },
  getTableRow: {
    contract: v2GetTableRowContract,
    summary: 'Get Row',
    description:
      "Get one row by identifier. Set `includeRunState=true` to attach the row's per-workflow-group run outcomes.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.GET),
  },
  getTableView: {
    contract: v2GetTableViewContract,
    summary: 'Get View',
    description: 'Get one saved table view by identifier.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.GET),
  },
  getTool: {
    contract: v2GetToolContract,
    summary: 'Get Tool',
    description:
      "Get a built-in tool's parameters and outputs. Registered IDs resolve exactly; other names resolve to the newest family version. The returned `id` identifies the resolved tool. Hidden or missing tools return `404`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/tools/[toolId]/route').then((route) => route.GET),
  },
  getWorkflow: {
    contract: v2GetWorkflowContract,
    summary: 'Get Workflow',
    description:
      'Get a workflow with its variables and deployed API-trigger inputs. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.GET),
  },
  getWorkflowChatDeployment: {
    contract: v2GetWorkflowChatDeploymentContract,
    summary: 'Get Workflow Chat Deployment',
    description:
      "Get a workflow's hosted chat and visitor access settings. Requires workspace admin access; a missing chat returns `404`. Passwords are never returned; `hasPassword` indicates whether one is set. Hosted chat and workflow API deployment are managed separately. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.GET
      ),
  },
  getWorkflowDeployment: {
    contract: v2GetWorkflowDeploymentContract,
    summary: 'Get Workflow Deployment',
    description:
      'Read live status, deployment time, latest attempt readiness and failure, draft divergence (`needsRedeployment`), anonymous execution access (`isPublicApi`), and registered webhook URLs. This read exposes public API access and webhook URLs; see their field descriptions for security and delivery details.\n\n`/workflows/{workflowId}/deployment` controls overall API executability; `/deployments/chat` controls only the hosted-chat surface. A workflow can remain deployed without a chat.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployment/route').then((route) => route.GET),
  },
  getWorkflowMcpServer: {
    contract: v2GetWorkflowMcpServerContract,
    summary: 'Get Workflow MCP Server',
    description:
      "Get a published workflow MCP server's metadata and client endpoint. Use List Workflow MCP Tools for its tool inventory. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.GET),
  },
  getWorkflowRun: {
    contract: v2GetWorkflowRunContract,
    summary: 'Get Workflow Run',
    description:
      'Get current run state with optional final and block outputs. With `includeOutput`, `files` includes download paths; `includeFileBase64` inlines file bytes and returns `413` with the download path when one file or the total exceeds 16 MiB. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/route').then((route) => route.GET),
  },
  getWorkflowState: {
    contract: v2GetWorkflowStateContract,
    summary: 'Get Workflow State',
    description:
      'Get the full editable draft graph, including blocks, edges, loop and parallel containers, variables, and stored input values. Use Inspect Workflow for compact, redacted diagnostics. Use this state with Replace Workflow State to preserve workspace bindings; Export Workflow removes those bindings for portability. This read records no audit event, and `HEAD` mirrors `GET`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/state/route').then((route) => route.GET),
  },
  getWorkflowVersion: {
    contract: v2GetWorkflowVersionContract,
    summary: 'Get Workflow Version',
    description:
      'Get an immutable deployment version and its pinned workflow graph snapshot.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/route').then(
        (route) => route.GET
      ),
  },
  getWorkspace: {
    contract: v2GetWorkspaceContract,
    summary: 'Get Workspace',
    description: 'Get metadata for an accessible workspace.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workspaces/[workspaceId]/route').then((route) => route.GET),
  },
  getWorkspaceForkAvailability: {
    contract: v2GetWorkspaceForkAvailabilityContract,
    summary: 'Get Workspace Fork Availability',
    description:
      'Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/availability/route').then(
        (route) => route.GET
      ),
  },
  getWorkspaceForkLineage: {
    contract: v2GetWorkspaceForkLineageContract,
    summary: 'Get Workspace Fork Lineage',
    description:
      'Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/lineage/route').then((route) => route.GET),
  },
  getWorkspaceForkMappings: {
    contract: v2GetWorkspaceForkMappingsContract,
    summary: 'Get Workspace Fork Mappings',
    description:
      'Read persisted mappings in the requested source-to-target direction. Candidate discovery uses the destination resource and selector listing operations. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/mappings/route').then(
        (route) => route.GET
      ),
  },
  getWorkspaceOperation: {
    contract: v2GetWorkspaceOperationContract,
    summary: 'Get Workspace Operation',
    description:
      'Read a committed operation, copy progress, exact deployment readiness, and structured issues. A failed follow-up does not mean the business transaction was rolled back.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/operations/[operationId]/route').then(
        (route) => route.GET
      ),
  },
  getWorkspacePermissionConfig: {
    contract: v2GetWorkspacePermissionConfigContract,
    summary: 'Get Workspace Permission Config',
    description:
      "Get the acting user's governing permission group and configuration for a workspace they can access. This describes permission-group restrictions, not the user's workspace role. Group and config are null when no group governs the caller; entitled indicates whether organization permission governance is active. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/permission-config/route').then(
        (route) => route.GET
      ),
  },
  grantSkillEditor: {
    contract: v2GrantSkillEditorContract,
    summary: 'Grant Skill Editor',
    description:
      'Grant skill editor access to a workspace member by email. Requires an existing editor or workspace admin; admins already have access and cannot receive explicit grants. Existing grants return `200`; new grants return `201`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.POST),
  },
  importWorkflow: {
    contract: v2ImportWorkflowContract,
    summary: 'Import Workflow',
    description:
      'Create an undeployed workflow from a portable export object, bare state, or JSON string. Mapping options require a preview fingerprint and stable request ID; unresolved required configuration creates nothing. Mapped imports return source-to-imported block IDs and an operation receipt. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/import/route').then((route) => route.POST),
  },
  inspectWorkflow: {
    contract: v2InspectWorkflowContract,
    summary: 'Inspect Workflow',
    description:
      'Inspect a compact draft graph with block IDs, enabled states, connections, and bounded nonempty inputs. Credential fields and opaque credential-bearing inputs are withheld; code is omitted unless requested. This diagnostic representation is not suitable for Replace Workflow State. Automatic redaction cannot recognize every secret in arbitrary text or code.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/inspect/route').then((route) => route.GET),
  },
  listAuditLogs: {
    contract: v2ListAuditLogsContract,
    summary: 'List Audit Logs',
    description:
      'List an organization audit trail with filters and opaque cursor pagination. Requires an Enterprise subscription and organization admin or owner access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/audit-logs/route').then((route) => route.GET),
  },
  listBillingLogs: {
    contract: v2ListBillingLogsContract,
    summary: 'List Billing Logs',
    description:
      'List credit usage with source filtering and cursor pagination. The default `period` is `30d`; pagination covers only the selected time window. An inverted custom window returns `400`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/billing/logs/route').then((route) => route.GET),
  },
  listBlocks: {
    contract: v2ListBlocksContract,
    summary: 'List Blocks',
    description:
      'List built-in and workspace-deployed blocks visible to the caller. Integration allowlists and preview visibility restrict results. Use `capability=trigger` for workflow starters and Get Block or Get Tool to resolve operation and tool IDs.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/blocks/route').then((route) => route.GET),
  },
  listChatDeployments: {
    contract: v2ListChatDeploymentsContract,
    summary: 'List Chat Deployments',
    description:
      "List hosted chats and their public URLs with cursor pagination. Filter by `workflowId` for one workflow's chat. The list requires workspace read access; Get Workflow Chat Deployment requires admin access and includes visitor access settings and customizations. Passwords are never returned.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/chat-deployments/route').then((route) => route.GET),
  },
  listConnectorTypes: {
    contract: v2ListConnectorTypesContract,
    summary: 'List Connector Types',
    description:
      'List knowledge-base connector types with opaque cursors, defaulting to 25 summaries per page: identifier, name, description, and auth mode. `detail=full` adds accepted source configuration fields. Fields with `multi: true` accept `string[]` instead of `string`. A `canonicalParamId` pairs a picker with manual entry for the same configuration key: send exactly one value, keyed by `canonicalParamId` rather than the field’s `id`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/connector-types/route').then((route) => route.GET),
  },
  listCredentialProviders: {
    contract: v2ListCredentialProvidersContract,
    summary: 'List Credential Providers',
    description:
      'List OAuth and service-account connection methods and their availability. OAuth options provide provider IDs for browser connections; service-account methods declare required fields and write-only secrets. Supports provider-name search. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/credentials/providers/route').then((route) => route.GET),
  },
  listCredentials: {
    contract: v2ListCredentialsContract,
    summary: 'List Credentials',
    description:
      'List OAuth and service-account connections visible to the caller. Secret material is never returned.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/credentials/route').then((route) => route.GET),
  },
  listCustomTools: {
    contract: v2ListCustomToolsContract,
    summary: 'List Custom Tools',
    description:
      'List code-backed custom tools in a workspace with cursor pagination.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/custom-tools/route').then((route) => route.GET),
  },
  listFileFolders: {
    contract: v2ListFileFoldersContract,
    summary: 'List Folders',
    description:
      'List workspace file folders with parent-path filtering and sorting. Use `scope=archived` to find paths accepted by Restore Folder. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.GET),
  },
  listFiles: {
    contract: v2ListFilesContract,
    summary: 'List Files',
    description:
      'List active workspace files with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find files available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/route').then((route) => route.GET),
  },
  listFileVersions: {
    contract: v2ListFileVersionsContract,
    summary: 'List File Versions',
    description:
      'List the versions of a file, newest first by default. Each write that changes the bytes records one; identical rewrites do not. Collaborative edits, and repeated workflow writes by one author, fold into a version under ten minutes old and written in the last five. Renames and moves are not versions. Retention removes older versions by age and plan but keeps the newest ten, so numbers can have gaps.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/versions/route').then((route) => route.GET),
  },
  listKnowledgeBases: {
    contract: v2ListKnowledgeBasesContract,
    summary: 'List Knowledge Bases',
    description:
      'List active knowledge bases in a workspace with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find knowledge bases available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/route').then((route) => route.GET),
  },
  listKnowledgeChunks: {
    contract: v2ListKnowledgeChunksContract,
    summary: 'List Chunks',
    description:
      'List document chunks with content search, enabled filtering, sorting, and cursor pagination. Tags use slots; use List Tags to resolve display names. Documents that have not finished processing return `409` with their current status. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route').then(
        (route) => route.GET
      ),
  },
  listKnowledgeConnectorDocuments: {
    contract: v2ListKnowledgeConnectorDocumentsContract,
    summary: 'List Knowledge Connector Documents',
    description:
      'List documents produced by one connector with opaque cursor pagination. Excluded documents are omitted unless explicitly requested. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents/route'
      ).then((route) => route.GET),
  },
  listKnowledgeConnectors: {
    contract: v2ListKnowledgeConnectorsContract,
    summary: 'List Knowledge Connectors',
    description:
      'List external sources connected to a knowledge base with cursor pagination. Stored API keys are never returned. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/route').then(
        (route) => route.GET
      ),
  },
  listKnowledgeDocuments: {
    contract: v2ListKnowledgeDocumentsContract,
    summary: 'List Documents',
    description:
      'List documents with filename search, state and tag filters, sorting, and cursor pagination. Tag values use display names; use List Tags to resolve the slots required for writes.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route').then((route) => route.GET),
  },
  listKnowledgeFolders: {
    contract: v2ListKnowledgeFoldersContract,
    summary: 'List Folders',
    description:
      'List folders in the knowledge-base folder tree with filtering and sorting. Returns the complete set in one page; `nextCursor` is always null. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.GET),
  },
  listKnowledgeTags: {
    contract: v2ListKnowledgeTagsContract,
    summary: 'List Tags',
    description:
      "List the knowledge base's tag definitions with display names, write slots, and field types. Filters and document reads use display names; document writes use slots. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.GET),
  },
  listKnowledgeTagUsage: {
    contract: v2ListKnowledgeTagUsageContract,
    summary: 'List Tag Usage',
    description:
      'Count the documents and chunks with a value for each defined tag. Returns the complete set in one page; `nextCursor` is always null. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/usage/route').then(
        (route) => route.GET
      ),
  },
  listLogs: {
    contract: v2ListLogsContract,
    summary: 'List Logs',
    description:
      'List logs with filters, selectable detail, sorting, and cursor pagination. `includeJobRuns=true` includes chat and Sim-agent jobs only with `sortBy=startedAt`, because other orderings are unsupported. `files` contains only run-produced files; use the files API for input attachments. Expired runs are permanently deleted. Retention is 30 days from run start on Free, unlimited on Pro and Team, and configured per organization on Enterprise with workspace overrides. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/logs/route').then((route) => route.GET),
  },
  listMcpServers: {
    contract: v2ListMcpServersContract,
    summary: 'List MCP Servers',
    description:
      'List MCP servers registered in a workspace, excluding request-header values and OAuth secrets. Connection metadata remains at registration defaults until List MCP Server Tools performs discovery.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/mcp-servers/route').then((route) => route.GET),
  },
  listMcpServerTools: {
    contract: v2ListMcpServerToolsContract,
    summary: 'List MCP Server Tools',
    description:
      'Discover up to 1,000 tools within 5 MB, connect to the server, and update connection metadata. Results are unpaginated. Invalid OAuth returns `409` with `MCP_SERVER_REAUTHORIZATION_REQUIRED`; reauthorize through the browser. Unavailable servers return `503`. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/tools/route').then((route) => route.GET),
  },
  listMyOrganizationAccessRequests: {
    contract: v2ListMyOrganizationAccessRequestsContract,
    summary: 'List My Organization Access Requests',
    description:
      'List the acting user’s organization-level requests and member credit-limit requests, including resolved history. For workspace-scoped requests, use List My Workspace Access Requests. History remains available while requests are disabled. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/mine/route').then(
        (route) => route.GET
      ),
  },
  listMyWorkspaceAccessRequests: {
    contract: v2ListMyWorkspaceAccessRequestsContract,
    summary: 'List My Workspace Access Requests',
    description:
      'List only the acting user’s requests in this workspace, including resolved history and organization-wide member credit-limit requests. History remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/access-requests/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationAccessRequests: {
    contract: v2ListOrganizationAccessRequestsContract,
    summary: 'List Organization Access Requests',
    description:
      'List requests across the organization for administrator review. Includes requests from organization members and external workspace collaborators; history remains available while requests are disabled. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationInvitations: {
    contract: v2ListOrganizationInvitationsContract,
    summary: 'List Organization Invitations',
    description:
      'List invitations owned by the organization, including invitations with workspace grants. Requires organization administrator access. Expired invitations are reported without modifying them. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationInvitationWorkspaces: {
    contract: v2ListOrganizationInvitationWorkspacesContract,
    summary: 'List Organization Invitation Workspaces',
    description:
      "List workspace grants attached to an invitation of any status. Includes archived workspaces still owned by the organization; workspaces moved to another organization are omitted. Requires organization administrator access. These grants describe the invitation, not the invitee's current access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces/route'
      ).then((route) => route.GET),
  },
  listOrganizationMembers: {
    contract: v2ListOrganizationMembersContract,
    summary: 'List Organization Members',
    description:
      'List organization members by name or email. Ordinary members must have access to the member directory; organization administrators retain access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/route').then(
        (route) => route.GET
      ),
  },
  listOrganizations: {
    contract: v2ListOrganizationsContract,
    summary: 'List Organizations',
    description:
      'List organizations the acting user belongs to. Organizations that disallow the calling credential are omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/organizations/route').then((route) => route.GET),
  },
  listOrganizationUsageEvents: {
    contract: v2ListOrganizationUsageEventsContract,
    summary: 'List Organization Usage Events',
    description:
      'Page through usage events, including zero-cost reporting. Requires organization administrator access and Usage Monitoring. Defaults to 30 days. Cursors retain the initial reporting window; keep filters and sort unchanged while paging. The sim-chat source covers both chat surfaces. Per-event rounding can produce credits=0 with hasCost=true. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/events/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationWorkspaces: {
    contract: v2ListOrganizationWorkspacesContract,
    summary: 'List Organization Workspaces',
    description:
      'List active workspaces owned by the organization. Requires organization administrator access; does not require Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/workspaces/route').then(
        (route) => route.GET
      ),
  },
  listPermissionGroupMembers: {
    contract: v2ListPermissionGroupMembersContract,
    summary: 'List Permission Group Members',
    description:
      'List explicit membership assignments in a permission group with cursor pagination. An empty inherit group applies to everyone in its workspaces. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/route'
      ).then((route) => route.GET),
  },
  listPermissionGroups: {
    contract: v2ListPermissionGroupsContract,
    summary: 'List Permission Groups',
    description:
      'List permission groups in an organization with cursor pagination. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/route').then(
        (route) => route.GET
      ),
  },
  listSandboxes: {
    contract: v2ListSandboxesContract,
    summary: 'List Sandboxes',
    description:
      'List reusable dependency environments for Function blocks, including language packages, managed CLIs, and system packages. Sandboxes remain visible after a plan downgrade.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/sandboxes/route').then((route) => route.GET),
  },
  listSecrets: {
    contract: v2ListSecretsContract,
    summary: 'List Secrets',
    description:
      'List workspace and caller-owned personal secrets with cursor pagination. Only workspace secrets marked `unredacted` include values; all other entries contain metadata only. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/route').then((route) => route.GET),
  },
  listSelector: {
    contract: v2ListSelectorContract,
    summary: 'List Selector Options',
    description:
      'List workspace-scoped configuration choices using the selector key and dependencies from an import or sync preview. Missing OAuth connections require human authorization before provider choices can be discovered. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/selectors/list/route').then((route) => route.POST),
  },
  listSkillEditors: {
    contract: v2ListSkillEditorsContract,
    summary: 'List Skill Editors',
    description:
      'List skill editors and workspace administrators with cursor pagination.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.GET),
  },
  listSkills: {
    contract: v2ListSkillsContract,
    summary: 'List Skills',
    description:
      'List workspace and built-in skills with cursor pagination. Built-in skills are read-only. The list omits skill bodies; use Get Skill to read content.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/route').then((route) => route.GET),
  },
  listTableDispatches: {
    contract: v2ListTableDispatchesContract,
    summary: 'List Run Dispatches',
    description:
      'List the run dispatches on one table, most recent first — settled dispatches (`complete`, `canceled`) alongside the ones still in flight, so a run that finished between two polls is still visible next to the `dispatchId` its create returned. Capped at the 100 most recent, so this list is unpaginated and `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/route').then((route) => route.GET),
  },
  listTableFolders: {
    contract: v2ListTableFoldersContract,
    summary: 'List Folders',
    description:
      'List table folders, optionally limiting results to direct children of a parent path. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.GET),
  },
  listTableRows: {
    contract: v2ListTableRowsContract,
    summary: 'List Rows',
    description:
      'List rows in default order with cursor pagination. Pages default to a 5 MB limit and may contain fewer rows than requested; continue until `nextCursor` is null. Use Query Rows for filtering and sorting. `includeRunState=true` adds per-group run outcomes and reduces the row limit.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.GET),
  },
  listTables: {
    contract: v2ListTablesContract,
    summary: 'List Tables',
    description:
      'List active tables with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find tables available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/route').then((route) => route.GET),
  },
  listTableViews: {
    contract: v2ListTableViewsContract,
    summary: 'List Views',
    description:
      'List saved table views, omitting references to removed columns. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/views/route').then((route) => route.GET),
  },
  listTools: {
    contract: v2ListToolsContract,
    summary: 'List Tools',
    description:
      "List built-in tools exposed by blocks visible to the caller. Use List MCP Server Tools for an external server's tools and List Custom Tools for workspace code-backed tools.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/tools/route').then((route) => route.GET),
  },
  listWorkflowFolders: {
    contract: v2ListWorkflowFoldersContract,
    summary: 'List Workflow Folders',
    description:
      'List workflow folders in a workspace. Returns the complete set in one page; `nextCursor` is always null. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.GET),
  },
  listWorkflowGroups: {
    contract: v2ListWorkflowGroupsContract,
    summary: 'List Workflow Groups',
    description:
      'List the workflow and enrichment groups that can be dispatched for a table. Returns the complete set in one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.GET),
  },
  listWorkflowMcpServers: {
    contract: v2ListWorkflowMcpServersContract,
    summary: 'List Workflow MCP Servers',
    description:
      "List MCP servers that expose deployed workflows to external clients. Use List MCP Servers for external servers Sim calls. Tool names share a 2,000-name page limit; inspect `toolNamesTruncated` and use List Workflow MCP Tools for a server's inventory. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/workflow-mcp-servers/route').then((route) => route.GET),
  },
  listWorkflowMcpTools: {
    contract: v2ListWorkflowMcpToolsContract,
    summary: 'List Workflow MCP Tools',
    description:
      'List published tools ordered by name, including the `workflowId` used to delete each registration. Undeploying a workflow makes its registrations `inactive`; redeploying reactivates them. Results are capped at 2,000 tools: `nextCursor` is always null, and `truncated` marks an incomplete inventory that cannot be paginated. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route').then((route) => route.GET),
  },
  listWorkflowRuns: {
    contract: v2ListWorkflowRunsContract,
    summary: 'List Workflow Runs',
    description:
      'List recorded runs of a workflow with filtering and opaque cursor pagination. Expired runs are permanently deleted. Retention is 30 days from run start on Free, unlimited on Pro and Team, and configured per organization on Enterprise with workspace overrides.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/route').then((route) => route.GET),
  },
  listWorkflows: {
    contract: v2ListWorkflowsContract,
    summary: 'List Workflows',
    description:
      'List active workflows in a workspace. Use `scope=archived` to find workflows available for restoration. Supports folder and deployment filters, search, sorting, and cursor pagination. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/route').then((route) => route.GET),
  },
  listWorkflowVersions: {
    contract: v2ListWorkflowVersionsContract,
    summary: 'List Workflow Versions',
    description:
      'List immutable deployment versions of a workflow, newest first.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/route').then((route) => route.GET),
  },
  listWorkspaceForkChildren: {
    contract: v2ListWorkspaceForkChildrenContract,
    summary: 'List Workspace Fork Children',
    description:
      'Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/children/route').then(
        (route) => route.GET
      ),
  },
  listWorkspaceForkResources: {
    contract: v2ListWorkspaceForkResourcesContract,
    summary: 'List Workspace Fork Resources',
    description:
      'Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/resources/route').then(
        (route) => route.GET
      ),
  },
  listWorkspaceMembers: {
    contract: v2ListWorkspaceMembersContract,
    summary: 'List Workspace Members',
    description:
      'List workspace members by email, including explicit grants and inherited organization admin access. Each member includes a stable user ID for member administration.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/members/route').then((route) => route.GET),
  },
  listWorkspaceOperations: {
    contract: v2ListWorkspaceOperationsContract,
    summary: 'List Workspace Operations',
    description:
      'Page committed operations newest first. Filter by the original request ID to reconcile an uncertain mutation response.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/operations/route').then((route) => route.GET),
  },
  listWorkspaces: {
    contract: v2ListWorkspacesContract,
    summary: 'List Workspaces',
    description:
      'List active workspaces available to the calling credential with opaque cursor pagination. A personal API key or OAuth token sees accessible workspaces that permit user-held API credentials; a workspace API key sees only its bound workspace.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workspaces/route').then((route) => route.GET),
  },
  moveFileItems: {
    contract: v2MoveFileItemsContract,
    summary: 'Move Files',
    description:
      'Move up to 1,000 files to a folder path or the workspace root.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/move/route').then((route) => route.POST),
  },
  moveTables: {
    contract: v2MoveTablesContract,
    summary: 'Move Tables and Folders',
    description:
      'Move up to 100 tables and folders to one destination. Items succeed or fail independently: covered tables are `skipped`, missing items are `notFound`, and lock or cycle failures include reasons in `failed`. An invalid destination rejects the request before any move.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/move/route').then((route) => route.POST),
  },
  moveWorkflows: {
    contract: v2MoveWorkflowsContract,
    summary: 'Move Workflows',
    description:
      'Move up to 100 workflows into one folder. Moves succeed or fail independently; missing, archived, or locked workflows appear in `failed`. Duplicate IDs are ignored. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/move/route').then((route) => route.POST),
  },
  previewOrganizationAccessRequest: {
    contract: v2PreviewOrganizationAccessRequestContract,
    summary: 'Preview Organization Access Request',
    description:
      'Preview the current permission changes, affected group and audience, or member credit cap. Review canApply, changes, impact, and fingerprint before resolving. Permission changes affect the entire governing group, not only the requester. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/preview/route'
      ).then((route) => route.GET),
  },
  previewWorkflowImport: {
    contract: v2PreviewWorkflowImportContract,
    summary: 'Preview Workflow Import',
    description:
      'Validate destination mappings and dependent choices without creating a workflow. Returns unresolved fields, discovery instructions, and a fingerprint required by mapped import. No source workspace is queried from imported provenance.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/import/preview/route').then((route) => route.POST),
  },
  previewWorkflowRunFromBlock: {
    contract: v2PreviewWorkflowRunFromBlockContract,
    summary: 'Preview Partial Workflow Run',
    description:
      'Inspect the current saved draft and one prior run without executing blocks or reserving a run ID. Returns executor entry validation, candidate rerun blocks, and upstream cached-output availability without output values. Requires write access to the workflow and OAuth api:read or a personal API key. Conditional paths are candidates, and a later run uses the draft saved at that time. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/preview/route').then((route) => route.GET),
  },
  previewWorkspaceFork: {
    contract: v2PreviewWorkspaceForkContract,
    summary: 'Preview Workspace Fork',
    description:
      'Preview the deployed workflows and explicitly selected resources that a new workspace fork would copy. The result is read-only and supplies the fingerprint required by Fork Workspace. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/preview/route').then(
        (route) => route.POST
      ),
  },
  previewWorkspacePull: {
    contract: v2PreviewWorkspacePullContract,
    summary: 'Preview Workspace Pull',
    description:
      'Preview deployed source workflows replacing mapped targets along a direct fork edge. Push sends the current workspace to the other; pull brings the other into the current workspace. Proposed mappings are not saved. Dependent choices use source workflow, block, and field identities. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/pull/preview/route').then(
        (route) => route.POST
      ),
  },
  previewWorkspacePush: {
    contract: v2PreviewWorkspacePushContract,
    summary: 'Preview Workspace Push',
    description:
      'Preview deployed source workflows replacing mapped targets along a direct fork edge. Push sends the current workspace to the other; pull brings the other into the current workspace. Proposed mappings are not saved. Dependent choices use source workflow, block, and field identities. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/push/preview/route').then(
        (route) => route.POST
      ),
  },
  pullWorkspace: {
    contract: v2PullWorkspaceContract,
    summary: 'Pull Workspace',
    description:
      'Apply a reviewed push or pull with inline mappings in one transaction. Requires confirmation, the preview fingerprint, and a stable request ID. Unresolved or changed plans return 409 without applying. The receipt distinguishes committed changes from copy and deployment readiness; poll Get Workspace Operation before treating the target as ready. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/pull/route').then((route) => route.POST),
  },
  pushWorkspace: {
    contract: v2PushWorkspaceContract,
    summary: 'Push Workspace',
    description:
      'Apply a reviewed push or pull with inline mappings in one transaction. Requires confirmation, the preview fingerprint, and a stable request ID. Unresolved or changed plans return 409 without applying. The receipt distinguishes committed changes from copy and deployment readiness; poll Get Workspace Operation before treating the target as ready. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/push/route').then((route) => route.POST),
  },
  queryRows: {
    contract: v2QueryRowsContract,
    summary: 'Query Rows',
    description:
      'Query rows with typed predicates, sorting, and cursor pagination. Omit the predicate to match all rows. Pages default to a 5 MB limit; continue until `nextCursor` is null. Oversized predicates return `413`. `includeRunState` adds per-group outcomes and reduces the row limit. Counts are read separately and can differ from paged results if rows change.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/query/route').then((route) => route.POST),
  },
  queryRowsCount: {
    contract: v2QueryRowsCountContract,
    summary: 'Count Rows',
    description:
      'Count rows matching a typed predicate, or omit the predicate to count all rows. The count is read separately from row pages and can change between requests. Oversized predicates return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/query/count/route').then((route) => route.POST),
  },
  readFileText: {
    contract: v2ReadFileTextContract,
    summary: 'Read File Text',
    description:
      'Extract text without changing the file. Accepts its ID or canonical path (`files/<folder>/<name>` or `uploads/<name>` for an unlisted chat upload); the response echoes the read path. Use Unzip File to unpack archives or Download File for original bytes. Unsupported types return `400`, compiling documents return `409`, and oversized files return `413`. `degraded: true` indicates incomplete or synthesized text, such as the legacy `.pptx` fallback; `truncated: true` indicates a parser limit.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/text/route').then((route) => route.GET),
  },
  readFileVersionText: {
    contract: v2ReadFileVersionTextContract,
    summary: 'Read File Version Text',
    description:
      'Extract the text of one version, exactly as Read File Text extracts the current content. Unsupported types return `400`, compiling documents return `409`, and oversized versions return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/text/route').then(
        (route) => route.GET
      ),
  },
  relocateFileFolder: {
    contract: v2RelocateFileFolderContract,
    summary: 'Rename or Move Folder',
    description:
      'Rename or move a folder and atomically update all descendant paths.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.PATCH),
  },
  relocateKnowledgeFolder: {
    contract: v2RelocateKnowledgeFolderContract,
    summary: 'Rename or Move Folder',
    description:
      'Rename or move a folder and atomically rewrite descendant paths. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.PATCH),
  },
  relocateTableFolder: {
    contract: v2RelocateTableFolderContract,
    summary: 'Rename or Move Folder',
    description:
      'Rename or move a table folder and update all descendant paths.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.PATCH),
  },
  relocateWorkflowFolder: {
    contract: v2RelocateWorkflowFolderContract,
    summary: 'Rename or Move Workflow Folder',
    description:
      'Rename or move a workflow folder and update all descendant paths. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.PATCH),
  },
  removeOrganizationMember: {
    contract: v2RemoveOrganizationMemberContract,
    summary: 'Remove Organization Member',
    description:
      'Remove a member and revoke their access to organization workspaces. Administrators may remove members; members may remove themselves. The organization owner cannot be removed. Owned organization resources are reassigned and the departing member’s sessions end. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/route').then(
        (route) => route.DELETE
      ),
  },
  removePermissionGroupMember: {
    contract: v2RemovePermissionGroupMemberContract,
    summary: 'Remove Permission Group Member',
    description:
      'Remove a member by user identifier. Removing the last member from an inherit group makes it govern everyone in its workspaces; a conflicting all-member group prevents the removal. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/[userId]/route'
      ).then((route) => route.DELETE),
  },
  renameFile: {
    contract: v2RenameFileContract,
    summary: 'Rename File',
    description:
      'Rename a workspace file without changing its containing folder.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/route').then((route) => route.PATCH),
  },
  replaceWorkflowChatDeployment: {
    contract: v2ReplaceWorkflowChatDeploymentContract,
    summary: 'Create or Replace Workflow Chat Deployment',
    description:
      "Create or replace a workflow's hosted chat and deploy its draft. Omitted fields reset to defaults except per-field customizations. Password authentication requires `password`; email or SSO requires non-empty `allowedEmails`. Public authentication allows anyone with the chat URL to use it. A duplicate identifier or pending deployment returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.PUT
      ),
  },
  replaceWorkflowState: {
    contract: v2ReplaceWorkflowStateContract,
    summary: 'Replace Workflow State',
    description:
      'Atomically replace the draft graph; row-locked concurrent writes are last-write-wins. Block, edge, or subflow IDs owned by another workflow return `409`. Deployments remain immutable snapshots; schedules and webhook registrations are unchanged. Deploy to publish edits. Lint is advisory. Use `dryRun=true` to validate without writing. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/state/route').then((route) => route.PUT),
  },
  resendOrganizationInvitation: {
    contract: v2ResendOrganizationInvitationContract,
    summary: 'Resend Organization Invitation',
    description:
      'Email an unexpired pending invitation again, renew its expiry, and replace its previous acceptance link. Requires organization administrator access and current invitation eligibility. Retrying sends another email; inspect the invitation after a delivery failure before retrying. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/resend/route'
      ).then((route) => route.POST),
  },
  resolveOrganizationAccessRequest: {
    contract: v2ResolveOrganizationAccessRequestContract,
    summary: 'Resolve Organization Access Request',
    description:
      'Apply a reviewed request or decline it with a reason. Applying requires the preview fingerprint; changed policy or membership returns a conflict. Credit requests also require a higher newLimitCredits. Already resolved requests are returned unchanged. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/resolve/route'
      ).then((route) => route.POST),
  },
  restoreFile: {
    contract: v2RestoreFileContract,
    summary: 'Restore File',
    description:
      'Restore a soft-deleted file to its original folder, or the workspace root if that folder was archived. Name collisions add a `_restored` suffix; read `folderPath` and `name` from the response. Already-active files return unchanged, making retries safe. An archived workspace returns `400`; an unresolved name collision returns `409`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/restore/route').then((route) => route.POST),
  },
  restoreFileFolder: {
    contract: v2RestoreFileFolderContract,
    summary: 'Restore Folder',
    description:
      'Restore a folder and the files and subfolders archived with it. Use the path from List Folders with `scope=archived`. A path that is not archived returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/restore/route').then((route) => route.POST),
  },
  restoreKnowledgeBase: {
    contract: v2RestoreKnowledgeBaseContract,
    summary: 'Restore Knowledge Base',
    description:
      'Restore a knowledge base and the documents and connectors archived with it. Active knowledge bases return unchanged without a new audit event. An archived workspace returns `409`; an archived containing folder moves the restored knowledge base to the workspace root. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/restore/route').then((route) => route.POST),
  },
  restoreTable: {
    contract: v2RestoreTableContract,
    summary: 'Restore Table',
    description:
      'Restore a table and its archived rows, views, and workflow groups. Active tables return unchanged without a new audit event. Name conflicts may change the returned `name`. Find archived tables with List Tables and `scope=archived`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/restore/route').then((route) => route.POST),
  },
  restoreTableFolder: {
    contract: v2RestoreTableFolderContract,
    summary: 'Restore Folder',
    description:
      'Restore an archived table folder, its descendants, and tables using its former path. An archived parent moves it to the root; name conflicts may change the returned `path`. Non-archived paths return `404`. Save the path from Delete Folder, because List Folders does not include archived table folders.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/restore/route').then((route) => route.POST),
  },
  restoreWorkflow: {
    contract: v2RestoreWorkflowContract,
    summary: 'Restore Workflow',
    description:
      'Restore an archived workflow and the schedules, webhooks, MCP tools, and chats archived with it. An active workflow returns `409`. If its folder is archived, the workflow returns to the workspace root. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/restore/route').then((route) => route.POST),
  },
  resumeWorkflow: {
    contract: v2ResumeWorkflowContract,
    summary: 'Resume Workflow Run',
    description:
      'Resume one human-in-the-loop pause. The resumed attempt receives a new run ID and returns either a synchronous result or a queue receipt.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/resume/route').then(
        (route) => route.POST
      ),
  },
  revertFileVersion: {
    contract: v2RevertFileVersionContract,
    summary: 'Revert File Version',
    description:
      'Make the content of a version current again by writing it as a new `revert` version, so the revert can itself be reverted. Open editors receive the change. Reverting to the current version writes nothing and returns `reverted: false`. A concurrent write, or an `expectedCurrentVersion` that is no longer current, returns `409`; a version above 100 MB returns `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/revert/route').then(
        (route) => route.POST
      ),
  },
  revertWorkflowVersion: {
    contract: v2RevertWorkflowVersionContract,
    summary: 'Revert Workflow To Version',
    description:
      'Replace the editable draft with a deployment version, discarding current draft edits. Use `active` for the live version. The live deployment remains unchanged; Activate Workflow Version or Rollback Workflow changes it. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/revert/route').then(
        (route) => route.POST
      ),
  },
  revokeOrganizationInvitation: {
    contract: v2RevokeOrganizationInvitationContract,
    summary: 'Revoke Organization Invitation',
    description:
      'Cancel an unexpired pending invitation and all its workspace grants so it can no longer be accepted. Requires organization administrator access. This does not remove a person who already accepted; use Remove Organization Member for that. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/route').then(
        (route) => route.DELETE
      ),
  },
  revokeSkillEditor: {
    contract: v2RevokeSkillEditorContract,
    summary: 'Revoke Skill Editor',
    description:
      'Revoke an explicit editor grant by email. The caller must already be a skill editor or workspace administrator. Workspace administrators have derived access that cannot be revoked. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.DELETE),
  },
  rollbackWorkflow: {
    contract: v2RollbackWorkflowContract,
    summary: 'Rollback Workflow',
    description:
      'Asynchronously activate a previous deployment version, defaulting to the preceding active version. Requires a deployed workflow and leaves the draft unchanged. Use Activate Workflow Version to select a version when the workflow is undeployed. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/rollback/route').then((route) => route.POST),
  },
  rollbackWorkspaceFork: {
    contract: v2RollbackWorkspaceForkContract,
    summary: 'Rollback Workspace Fork',
    description:
      'Restore the latest sync into this workspace using its prior deployed versions. Requires target admin. It does not restore arbitrary drafts or remove every copied resource. Pending activations are reported. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/rollback/route').then(
        (route) => route.POST
      ),
  },
  runRowEnrichment: {
    contract: v2RunRowEnrichmentContract,
    summary: 'Run Enrichment For One Row',
    description:
      'Start one workflow or enrichment group for a table row. Poll Get Run Dispatch using the returned `dispatchId`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route').then(
        (route) => route.POST
      ),
  },
  searchFileContent: {
    contract: v2SearchFileContentContract,
    summary: 'Search File Content',
    description:
      'Search indexed text in active workspace files and return matching lines with file IDs and line numbers. `folderPaths` limits both results and reported coverage. Missing matches are inconclusive if `complete` is false or `indexStatus.skippedFiles` or `indexStatus.partialFiles` is nonzero. `truncated` means additional matches exist beyond `maxResults`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/search/route').then((route) => route.GET),
  },
  searchKnowledge: {
    contract: v2SearchKnowledgeContract,
    summary: 'Search Knowledge',
    description:
      'Search one or more knowledge bases with semantic vector retrieval, optional hybrid full-text retrieval, and structured tag filters. Every result names the `knowledgeBaseId` it came from. A request body over 2 MiB is a `413`. Reranking returns `409` when the stored results cannot pass secret-provenance enforcement.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/search/route').then((route) => route.POST),
  },
  searchTableRows: {
    contract: v2SearchTableRowsContract,
    summary: 'Search Rows',
    description:
      'Search cell text for a case-insensitive substring within an optional filtered and sorted view. Returns cell coordinates, not row data; `ordinal` matches the view used by Query Rows. Results are unpaginated and capped at 1000. If `truncated` is true, narrow the search or predicate.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/search/route').then((route) => route.POST),
  },
  setSecret: {
    contract: v2SetSecretContract,
    summary: 'Set Secret',
    description:
      'Create or replace a workspace or personal secret without returning its value. For existing workspace secrets, omit `value` to update metadata only; this returns `404` if absent. Personal secrets always require `value`. List Secrets can reveal workspace values marked `unredacted`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/[name]/route').then((route) => route.PUT),
  },
  syncKnowledgeConnector: {
    contract: v2SyncKnowledgeConnectorContract,
    summary: 'Sync Knowledge Connector',
    description:
      'Queue a connector synchronization. Rehydration forces existing documents to be fetched and indexed again. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync/route').then(
        (route) => route.POST
      ),
  },
  tableExportDownload: {
    contract: v2TableExportDownloadContract,
    summary: 'Download Table Export',
    description:
      'Get a short-lived signed download URL for a completed export. Other states return `409`; an unavailable export file returns `404`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/download/route').then(
        (route) => route.GET
      ),
  },
  undeployWorkflow: {
    contract: v2UndeployWorkflowContract,
    summary: 'Undeploy Workflow',
    description:
      'Deactivate the currently serving workflow version. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deploy/route').then((route) => route.DELETE),
  },
  undeployWorkflowMcpTool: {
    contract: v2UndeployWorkflowMcpToolContract,
    summary: 'Unpublish Workflow MCP Tool',
    description:
      "Unpublish an MCP tool by its workflow ID. The workflow's API deployment remains active. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]/route').then(
        (route) => route.DELETE
      ),
  },
  unlinkWorkspaceFork: {
    contract: v2UnlinkWorkspaceForkContract,
    summary: 'Unlink Workspace Fork',
    description:
      'Remove the direct fork relationship and its mappings. Requires admin on the acting workspace. Existing workflow and resource content remains available. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/unlink/route').then((route) => route.POST),
  },
  unzipFile: {
    contract: v2UnzipFileContract,
    summary: 'Unzip File',
    description:
      'Extract a ZIP archive into a new sibling folder and return counts and the destination path. Use List Files to inspect its contents. Large archives can take minutes; concurrent extraction of the same archive returns `409`. Size or processing-time limits return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/unzip/route').then((route) => route.POST),
  },
  updateCredential: {
    contract: v2UpdateCredentialContract,
    summary: 'Update Credential',
    description:
      'Rename a service-account credential or rotate its secret fields, preserving omitted values and the credential ID. Requires credential admin access. Provider rejection preserves the old secret and returns `400` with `providerErrorCode`; outages return `503`. Fields for a different credential type return `400`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/route').then((route) => route.PATCH),
  },
  updateCustomTool: {
    contract: v2UpdateCustomToolContract,
    summary: 'Update Custom Tool',
    description:
      'Update a custom tool. Omitted fields remain unchanged; titles must remain unique within the workspace.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.PATCH),
  },
  updateFileContent: {
    contract: v2UpdateFileContentContract,
    summary: 'Replace File Content',
    description:
      'Replace the complete contents of an existing file from UTF-8 or base64 input. A stale `expectedRevision`, or a write that raced this one, returns `409`; re-read before retrying.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/content/route').then((route) => route.PUT),
  },
  updateKnowledgeBase: {
    contract: v2UpdateKnowledgeBaseContract,
    summary: 'Update Knowledge Base',
    description:
      "Update a knowledge base's name, description, chunking configuration, or folder placement. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.PATCH),
  },
  updateKnowledgeChunk: {
    contract: v2UpdateKnowledgeChunkContract,
    summary: 'Update Chunk',
    description:
      'Correct chunk text or disable it from search. Changing `content` re-embeds immediately and recalculates document token and character counts; disabling retains the index. Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document. Documents that have not finished processing return `409` with their current status. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]/route'
      ).then((route) => route.PATCH),
  },
  updateKnowledgeConnector: {
    contract: v2UpdateKnowledgeConnectorContract,
    summary: 'Update Knowledge Connector',
    description:
      'Update connector source configuration, schedule, or active state. Replacing source configuration on a runnable connector queues an immediate synchronization; paused connectors retain the change without synchronizing until resumed. Source configuration cannot be replaced while synchronization is already in progress. Authentication material cannot be changed through this operation. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateKnowledgeConnectorDocuments: {
    contract: v2UpdateKnowledgeConnectorDocumentsContract,
    summary: 'Update Knowledge Connector Documents',
    description:
      'Exclude connector documents from knowledge search or restore previously excluded documents. Only documents produced by the selected connector can change. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents/route'
      ).then((route) => route.PATCH),
  },
  updateKnowledgeDocument: {
    contract: v2UpdateKnowledgeDocumentContract,
    summary: 'Update Document',
    description:
      'Rename a document, change search availability, update tag slots, or requeue processing. Omitted fields remain unchanged; indexing state is read-only. Use List Tags to resolve names to slots and Get Document for source connector details, which this response omits. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateKnowledgeTag: {
    contract: v2UpdateKnowledgeTagContract,
    summary: 'Update Tag',
    description:
      "Rename a tag or change its slot-compatible `fieldType`. Renaming changes read and filter names without moving the slot or its values. Slots are fixed for a tag's lifetime; an incompatible type returns `400` and requires creating a new tag. A duplicate display name returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateMcpServer: {
    contract: v2UpdateMcpServerContract,
    summary: 'Update MCP Server',
    description:
      "Update an MCP server's supplied fields. Omitted fields remain unchanged unless the field specifies otherwise. Authentication changes revoke the stored OAuth grant and reset connection metadata. Use List MCP Server Tools to reconnect.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.PATCH),
  },
  updateOrganizationAccessRequestSettings: {
    contract: v2UpdateOrganizationAccessRequestSettingsContract,
    summary: 'Update Organization Access Request Settings',
    description:
      'Allow or pause new access requests and approvals. Pausing preserves history, cancellation, and decline, and does not revoke previously granted access. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/settings/route').then(
        (route) => route.PATCH
      ),
  },
  updateOrganizationMember: {
    contract: v2UpdateOrganizationMemberContract,
    summary: 'Update Organization Member',
    description:
      'Change a member’s organization role. Requires organization administrator access. The owner’s role and memberships managed by an identity provider cannot be changed here. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateOrganizationMemberUsageLimit: {
    contract: v2UpdateOrganizationMemberUsageLimitContract,
    summary: 'Update Organization Member Credit Limit',
    description:
      'Set or clear a person’s credit cap. Hosted only. The userId must identify an organization member or external collaborator with workspace access in this organization. The cap is a nonnegative whole number of credits, not dollars: 0 prevents further credit-consuming usage; null removes the per-person cap. Organization limits continue to apply. Retrying the same value is safe. Requires organization administrator access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/usage-limit/route').then(
        (route) => route.PATCH
      ),
  },
  updatePermissionGroup: {
    contract: v2UpdatePermissionGroupContract,
    summary: 'Update Permission Group',
    description:
      'Update a permission group. Omitted fields remain unchanged; config keys are patched and supplied arrays replace their lists. Promoting a group to default demotes the previous default; demoting without workspaceIds leaves it inactive. Overlapping member or all-member scopes conflict. Requires organization admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateRowsByFilter: {
    contract: v2UpdateRowsByFilterContract,
    summary: 'Update Rows by Filter',
    description:
      'Apply the same partial data patch to every row matching a non-empty predicate.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.PATCH),
  },
  updateSandbox: {
    contract: v2UpdateSandboxContract,
    summary: 'Update Sandbox',
    description:
      'Update a sandbox, preserving omitted fields and replacing supplied lists. Dependency changes may start a build; resending a failed specification retries its build. `buildStatus: null` means no build is required. Requires workspace admin access on Max or Enterprise. Creates and updates share a rate limit; respect `Retry-After`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.PATCH),
  },
  updateSkill: {
    contract: v2UpdateSkillContract,
    summary: 'Update Skill',
    description:
      'Update a workspace skill. Omitted fields remain unchanged. Built-in skills are read-only. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.PATCH),
  },
  updateTable: {
    contract: v2UpdateTableContract,
    summary: 'Update Table',
    description:
      'Rename a table, edit its description, or move it to a folder. Fields are saved independently: a failed request may leave partial changes. `error.details.applied` lists saved fields; retry only the remaining fields. If absent, nothing changed. Lock flags are read-only. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.PATCH),
  },
  updateTableColumn: {
    contract: v2UpdateTableColumnContract,
    summary: 'Update Column',
    description:
      'Update a column by name and return the complete schema. Renames update rows, views, and workflow-group references keyed by column ID. Workflow Table blocks keep their authored `filter`, `order`, and `data` JSON unchanged. Bound blocks still referencing the old name appear in `unmigrated`; edit them with Apply Workflow Operations to prevent failures on their next run.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.PATCH),
  },
  updateTableRow: {
    contract: v2UpdateTableRowContract,
    summary: 'Update Row',
    description:
      'Merge a partial data patch into one row by identifier.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.PATCH),
  },
  updateTableView: {
    contract: v2UpdateTableViewContract,
    summary: 'Update View',
    description:
      'Rename a view, replace or shallow-merge its configuration, or promote it to the table default.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.PATCH),
  },
  updateWorkflow: {
    contract: v2UpdateWorkflowContract,
    summary: 'Update Workflow',
    description:
      "Update a workflow's name, description, or folder path. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () => import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.PATCH),
  },
  updateWorkflowGroup: {
    contract: v2UpdateWorkflowGroupContract,
    summary: 'Update Workflow Group',
    description:
      'Restructure a workflow group, its producer, outputs, or execution behavior. Repointing the group at a different workflow concurrently invalidates the resolved output types and returns `409` — retry the update.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.PATCH),
  },
  updateWorkflowMcpServer: {
    contract: v2UpdateWorkflowMcpServerContract,
    summary: 'Update Workflow MCP Server',
    description:
      "Update a workflow MCP server's name, description, or public access. Omitted fields remain unchanged; `description: null` clears the description. Publish or unpublish tools separately. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.PATCH),
  },
  updateWorkflowPublicApi: {
    contract: v2UpdateWorkflowPublicApiContract,
    summary: 'Update Workflow Public API Access',
    description:
      'Enable or disable unauthenticated execution of the deployed workflow. Enabling allows anyone with the execution URL to consume billed usage. Organization sharing restrictions return `403` with `PUBLIC_SHARING_NOT_ALLOWED`. Hosted chat is managed separately. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployment/route').then((route) => route.PATCH),
  },
  updateWorkflowVersion: {
    contract: v2UpdateWorkflowVersionContract,
    summary: 'Update Workflow Version',
    description:
      "Update a deployment version's name or release note. Omitted fields remain unchanged; `description: null` clears the note. The graph and live version remain unchanged. Use Activate Workflow Version to make this version live.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/route').then(
        (route) => route.PATCH
      ),
  },
  updateWorkspaceForkExclusions: {
    contract: v2UpdateWorkspaceForkExclusionsContract,
    summary: 'Update Workspace Fork Exclusions',
    description:
      'Include or exclude selected workflows from fork sync. Excluded workflows are skipped as sources and targets. Missing, archived, and unchanged workflow IDs are skipped. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/exclusions/route').then(
        (route) => route.PUT
      ),
  },
  updateWorkspaceForkMappings: {
    contract: v2UpdateWorkspaceForkMappingsContract,
    summary: 'Update Workspace Fork Mappings',
    description:
      'Update edge mappings after validating destination resource membership and credential provider compatibility. Push addresses current-to-other mappings; pull addresses other-to-current mappings. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/mappings/route').then(
        (route) => route.PUT
      ),
  },
  upsertFileShare: {
    contract: v2UpsertFileShareContract,
    summary: 'Enable or Disable File Share',
    description:
      "Create or update a file's public share. `isActive` is required; other fields describe their behavior when access modes change. Enabling a protected mode on a previously unshared file requires its credential in the same request. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/files/[fileId]/share/route').then((route) => route.PATCH),
  },
  upsertTableRow: {
    contract: v2UpsertTableRowContract,
    summary: 'Upsert Row',
    description:
      'Insert a row or replace the row matching a selected unique column. On replacement, omitted columns are cleared; send the complete row. Use Update Row for a partial patch.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/upsert/route').then((route) => route.POST),
  },
} as const satisfies Record<string, V2McpOperation>

export type V2McpOperationName = keyof typeof V2_MCP_OPERATIONS
