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
  v2ListCredentialMembersContract,
  v2ListCredentialProvidersContract,
  v2ListCredentialsContract,
  v2RemoveCredentialMemberContract,
  v2UpdateCredentialContract,
  v2UpsertCredentialMemberContract,
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
  v2CancelKnowledgeImportContract,
  v2CompleteKnowledgeDocumentUploadContract,
  v2CompleteKnowledgeImportContract,
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeConnectorContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadPartUrlsContract,
  v2CreateKnowledgeFolderContract,
  v2CreateKnowledgeImportContract,
  v2CreateKnowledgeImportPartUrlsContract,
  v2DeleteKnowledgeBaseContract,
  v2DeleteKnowledgeConnectorContract,
  v2DeleteKnowledgeDocumentContract,
  v2DeleteKnowledgeFolderContract,
  v2GetKnowledgeBaseContract,
  v2GetKnowledgeConnectorContract,
  v2GetKnowledgeDocumentContract,
  v2GetKnowledgeImportContract,
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
  v2AddOrganizationDomainContract,
  v2DeleteSsoProviderContract,
  v2GetSsoPolicyContract,
  v2GetSsoProviderContract,
  v2ListOrganizationDomainsContract,
  v2ListSsoProvidersContract,
  v2RemoveOrganizationDomainContract,
  v2SaveSsoProviderContract,
  v2SetPrimarySsoProviderContract,
  v2UpdateSsoPolicyContract,
  v2VerifyOrganizationDomainContract,
} from '@/lib/api/contracts/v2/sso'
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
  v2CompareWorkflowVersionsContract,
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
    summary: 'Abort file upload',
    description:
      'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/route').then((route) => route.DELETE),
  },
  abortKnowledgeDocumentUpload: {
    contract: v2AbortKnowledgeDocumentUploadContract,
    summary: 'Abort document upload',
    description:
      'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/route').then(
        (route) => route.DELETE
      ),
  },
  activateWorkflowVersion: {
    contract: v2ActivateWorkflowVersionContract,
    summary: 'Activate workflow version',
    description:
      'Activate a specific deployment version asynchronously. Requires workspace Admin access and works when the workflow is undeployed. The draft is unchanged. Poll Get workflow deployment for the accepted `latestDeploymentAttempt`; `isDeployed` alone can describe an older live version. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/activate/route').then(
        (route) => route.POST
      ),
  },
  addOrganizationDomain: {
    contract: v2AddOrganizationDomainContract,
    summary: 'Add organization domain',
    description:
      'Claim a domain and receive its DNS TXT challenge. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. An organization can claim at most 25 domains. Existing claims return `200`; new claims return `201`. A domain verified by another organization returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/domains/route').then(
        (route) => route.POST
      ),
  },
  addPermissionGroupMember: {
    contract: v2AddPermissionGroupMemberContract,
    summary: 'Add permission group member',
    description:
      'Assign an organization member to a permission group. An existing assignment or membership in another group targeting the same workspace returns a conflict. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/route'
      ).then((route) => route.POST),
  },
  addTableColumn: {
    contract: v2AddTableColumnContract,
    summary: 'Add column',
    description:
      'Add a typed column and return the complete resulting table schema.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.POST),
  },
  addWorkflowGroup: {
    contract: v2AddWorkflowGroupContract,
    summary: 'Add workflow group',
    description:
      'Bind a workflow or enrichment to the table and create the columns populated by its outputs. An output whose column the table already has attaches that column to the group instead of creating it, so `outputColumns` may be omitted when every output lands in an existing column.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.POST),
  },
  addWorkspaceFilesToKnowledgeBase: {
    contract: v2AddWorkspaceFilesToKnowledgeBaseContract,
    summary: 'Index workspace files',
    description:
      'Queue stored workspace files for indexing without re-uploading bytes. Unreadable, unsupported, or over-100 MiB files appear in `failed`; valid files are queued. Partial success returns `200`. Use Get document to poll processing after receiving document IDs. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files/route').then(
        (route) => route.POST
      ),
  },
  applyWorkflowOperations: {
    contract: v2ApplyWorkflowOperationsContract,
    summary: 'Apply workflow operations',
    description:
      'Apply draft edits and block enablement changes in one write. Requires workspace write access. The live deployment is unchanged; lint is advisory.\n\nInspect `skipped` and `inputValidationErrors` for edits that did not apply. Deferred edges apply when their targets exist; do not resubmit them. With `atomic=true`, declined operations or dropped inputs return `409` (`OPERATIONS_NOT_APPLIED`) without saving. Use returned `mintedBlockIds` in later requests. `dryRun=true` evaluates without saving, auditing, or notifying. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/operations/route').then((route) => route.POST),
  },
  applyWorkflowVariables: {
    contract: v2ApplyWorkflowVariablesContract,
    summary: 'Update workflow variables',
    description:
      'Add, edit, or delete variables by name with workspace write access. Operations run in order. Values are coerced to their declared type when possible and otherwise stored as supplied. A no-op batch returns `changed: false`; read current values with Get workflow.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/variables/route').then((route) => route.PATCH),
  },
  bulkAddPermissionGroupMembers: {
    contract: v2BulkAddPermissionGroupMembersContract,
    summary: 'Bulk add permission group members',
    description:
      'Assign up to 1000 selected organization members, or the entire organization roster, atomically. Existing assignments are skipped and users outside the organization are ignored. Any overlapping membership conflict rejects the entire batch. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/bulk/route'
      ).then((route) => route.POST),
  },
  bulkDeleteFiles: {
    contract: v2BulkDeleteFilesContract,
    summary: 'Delete files',
    description:
      'Archive up to 1,000 workspace files while retaining their stored bytes. Use Restore file to recover each file.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/bulk-delete/route').then((route) => route.POST),
  },
  bulkDeleteTables: {
    contract: v2BulkDeleteTablesContract,
    summary: 'Bulk delete tables and folders',
    description:
      'Archive up to 100 selected tables and folders, including folder contents. Items succeed or fail independently, with `skipped`, `notFound`, and `failed` outcomes. `deletedItems` includes all descendants. Use Restore table or Restore folder to recover archived items.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/bulk-delete/route').then((route) => route.POST),
  },
  bulkSaveKnowledgeTagDefinitions: {
    contract: v2BulkSaveKnowledgeTagDefinitionsContract,
    summary: 'Bulk save tag definitions',
    description:
      'Create or update tag definitions, preserving unspecified slots. Updates require `originalDisplayName`; other entries create tags. Slot and name conflicts appear in per-definition `errors` with HTTP `200`, leaving conflicting values unchanged. Use Update document to set tag values. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.PUT),
  },
  bulkUpdateKnowledgeChunks: {
    contract: v2BulkUpdateKnowledgeChunksContract,
    summary: 'Bulk update chunks',
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
    summary: 'Bulk enable or disable documents',
    description:
      'Enable or disable selected documents, or use `selectAll` for the entire knowledge base. Use Delete document to remove documents individually. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route').then(
        (route) => route.PATCH
      ),
  },
  bulkUpdateTableRows: {
    contract: v2BulkUpdateTableRowsContract,
    summary: 'Bulk update rows',
    description:
      'Apply separate partial patches to up to 1,000 rows, preserving omitted columns. A row outside the table rejects the entire request with `400` and lists missing IDs. Use Update rows by filter to apply one patch to every matching row.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/bulk-update/route').then((route) => route.POST),
  },
  cancelKnowledgeImport: {
    contract: v2CancelKnowledgeImportContract,
    summary: 'Cancel knowledge base import',
    description:
      'Cancel an import. During its upload the transfer is aborted; while processing, it stops after the document in flight and the documents already imported stay in the new knowledge base. Settled imports return `409`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/imports/[importId]/route').then((route) => route.DELETE),
  },
  cancelOrganizationAccessRequest: {
    contract: v2CancelOrganizationAccessRequestContract,
    summary: 'Cancel organization access request',
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
    summary: 'Cancel run dispatch',
    description:
      'Stop a dispatch from scheduling more cells. Already queued or running cells continue; use Cancel column runs to stop them. Completed or canceled dispatches return unchanged.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route').then(
        (route) => route.DELETE
      ),
  },
  cancelTableExport: {
    contract: v2CancelTableExportContract,
    summary: 'Cancel table export',
    description: 'Cancel an export that is still in progress.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/route').then(
        (route) => route.DELETE
      ),
  },
  cancelTableImport: {
    contract: v2CancelTableImportContract,
    summary: 'Cancel table import',
    description:
      'Cancel an upload or processing import. Committed row batches remain. Non-cancelable states, including `expired`, return `409`; unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/route').then((route) => route.DELETE),
  },
  cancelTableRuns: {
    contract: v2CancelTableRunsContract,
    summary: 'Cancel column runs',
    description:
      'Stop in-flight and pending workflow or enrichment cell runs across the table or one selected row.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/cancel-runs/route').then((route) => route.POST),
  },
  cancelWorkflowRun: {
    contract: v2CancelWorkflowRunContract,
    summary: 'Cancel workflow run',
    description:
      'Request cancellation of a running, queued, or paused workflow run with workspace write access. Cancellation is best effort; inspect the outcome flags and `reason`. A terminal run returns `200` with `success: false` and an `already_*` reason. A table workflow-group run returns `409` when its cell can no longer accept cancellation.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route').then(
        (route) => route.POST
      ),
  },
  cancelWorkspaceAccessRequest: {
    contract: v2CancelWorkspaceAccessRequestContract,
    summary: 'Cancel workspace access request',
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
  compareWorkflowVersions: {
    contract: v2CompareWorkflowVersionsContract,
    summary: 'Compare workflow versions',
    description:
      'Compare two deployment versions of the same workflow with workspace read access. The comparison excludes layout changes and withholds credential-bearing values while reporting their changes. Connections include stable block and port IDs. The combined snapshots and the comparison result must each fit within 16 MiB.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/compare/route').then(
        (route) => route.GET
      ),
  },
  completeFileUpload: {
    contract: v2CompleteFileUploadContract,
    summary: 'Complete file upload',
    description:
      'Finalize an upload and register its workspace file. Repeating a completed upload returns the existing file.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/complete/route').then((route) => route.POST),
  },
  completeKnowledgeDocumentUpload: {
    contract: v2CompleteKnowledgeDocumentUploadContract,
    summary: 'Complete document upload',
    description:
      'Verify a direct upload or assemble multipart parts, create the knowledge document, and queue asynchronous processing.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'
      ).then((route) => route.POST),
  },
  completeKnowledgeImport: {
    contract: v2CompleteKnowledgeImportContract,
    summary: 'Complete knowledge base import upload',
    description:
      "Verify the uploaded bundle and start creating the knowledge base under the same import ID. Vectors are reused when the bundle was embedded with this deployment's model; otherwise documents are re-indexed. Completion records an audit event. Repeating it returns the running import.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/knowledge/imports/[importId]/complete/route').then(
        (route) => route.POST
      ),
  },
  completeTableImport: {
    contract: v2CompleteTableImportContract,
    summary: 'Complete table import upload',
    description:
      'Verify or assemble uploaded CSV bytes and start processing under the same import ID. Requires an import awaiting upload completion; other states return `409`. Unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/complete/route').then((route) => route.POST),
  },
  createCredentialConnection: {
    contract: v2CreateCredentialConnectionContract,
    summary: 'Create credential connection',
    description:
      'Create a short-lived browser URL to connect an OAuth provider or reconnect a credential. Requires workspace write access; reconnecting also requires credential Admin access. Open the URL, sign in as the acting user, complete provider authorization, then refresh List credentials. QuickBooks requires caller-managed `oauthClientConfig` for either flow. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/credentials/connections/route').then((route) => route.POST),
  },
  createCustomTool: {
    contract: v2CreateCustomToolContract,
    summary: 'Create custom tool',
    description:
      'Create a code-backed custom tool. Its title must be unique within the workspace because tools resolve by title at call time. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/custom-tools/route').then((route) => route.POST),
  },
  createFile: {
    contract: v2CreateFileContract,
    summary: 'Create file',
    description:
      'Create a workspace file from inline UTF-8 or base64 content. Use an upload session for streamed or larger files.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/route').then((route) => route.POST),
  },
  createFileFolder: {
    contract: v2CreateFileFolderContract,
    summary: 'Create folder',
    description: 'Create a folder at the supplied workspace path.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.POST),
  },
  createFileUpload: {
    contract: v2CreateFileUploadContract,
    summary: 'Create file upload',
    description:
      'Create a resumable upload session and receive either a signed PUT URL or multipart instructions.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/uploads/route').then((route) => route.POST),
  },
  createFileUploadPartUrls: {
    contract: v2CreateFileUploadPartUrlsContract,
    summary: 'Create file upload part URLs',
    description:
      'Create signed URLs for a bounded set of multipart upload part numbers.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/uploads/[uploadId]/parts/route').then((route) => route.POST),
  },
  createKnowledgeBase: {
    contract: v2CreateKnowledgeBaseContract,
    summary: 'Create knowledge base',
    description:
      'Create a knowledge base in a workspace with optional folder placement and chunking configuration. An unknown `folderPath` returns `404`. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/route').then((route) => route.POST),
  },
  createKnowledgeChunk: {
    contract: v2CreateKnowledgeChunkContract,
    summary: 'Create chunk',
    description:
      'Append a chunk and embed it before returning. It inherits the document\'s tags and next `chunkIndex`. Search includes it when the chunk and document are enabled and the document has completed processing. Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route').then(
        (route) => route.POST
      ),
  },
  createKnowledgeConnector: {
    contract: v2CreateKnowledgeConnectorContract,
    summary: 'Create knowledge connector',
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
    summary: 'Create document upload',
    description:
      'Create a resumable upload session and receive direct PUT or multipart transfer instructions.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route').then(
        (route) => route.POST
      ),
  },
  createKnowledgeDocumentUploadPartUrls: {
    contract: v2CreateKnowledgeDocumentUploadPartUrlsContract,
    summary: 'Create document upload part URLs',
    description:
      'Create short-lived signed PUT URLs for up to 100 multipart part numbers.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts/route'
      ).then((route) => route.POST),
  },
  createKnowledgeFolder: {
    contract: v2CreateKnowledgeFolderContract,
    summary: 'Create folder',
    description:
      'Create a folder in the knowledge-base folder tree. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.POST),
  },
  createKnowledgeImport: {
    contract: v2CreateKnowledgeImportContract,
    summary: 'Create knowledge base import',
    description:
      'Start importing a knowledge base bundle produced by an export. The response carries signed transfer instructions for the archive; once its bytes are uploaded, complete the import to create the knowledge base. Bundles must be `.zip` archives of at most 5 GiB.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/imports/route').then((route) => route.POST),
  },
  createKnowledgeImportPartUrls: {
    contract: v2CreateKnowledgeImportPartUrlsContract,
    summary: 'Create knowledge base import part URLs',
    description:
      'Create signed URLs for multipart bundle upload parts. Requires the `uploading` state; other states return `409`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/imports/[importId]/parts/route').then((route) => route.POST),
  },
  createKnowledgeTag: {
    contract: v2CreateKnowledgeTagContract,
    summary: 'Create tag',
    description:
      'Create a tag definition. Write document values by `tagSlot` and filter by `displayName`. Omitting `tagSlot` selects a free slot; exhaustion returns `400`. An occupied slot or duplicate name returns `409`. Use Bulk save tag definitions for multiple definitions. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.POST),
  },
  createMcpServer: {
    contract: v2CreateMcpServerContract,
    summary: 'Create MCP server',
    description:
      'Register an external MCP server without establishing a tool connection; registration may probe its authentication method. A duplicate URL returns `409`; use Update MCP server to change the registration. It stays disconnected until List MCP server tools succeeds. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/mcp-servers/route').then((route) => route.POST),
  },
  createOrganizationAccessRequest: {
    contract: v2CreateOrganizationAccessRequestContract,
    summary: 'Create organization access request',
    description:
      'Request access using a target from Discover organization access requests. Requires organization membership and requests enabled. Each requester can have 100 pending requests and submit 100 in 24 hours within the organization. Matching pending requests are reused; an existing request may be closed if access is already available. Permission approvals change the governing group for all affected members. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/route').then(
        (route) => route.POST
      ),
  },
  createOrganizationInvitation: {
    contract: v2CreateOrganizationInvitationContract,
    summary: 'Create organization invitation',
    description:
      'Email an invitation to join the organization as a member or Admin. Requires organization Admin access and invitations enabled; an eligible plan and available seat are required when billing is enabled. It grants no workspace-specific permissions. Existing organization membership or an unexpired pending invitation for the email returns `409`. Use Resend organization invitation to send a pending invitation again. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/route').then(
        (route) => route.POST
      ),
  },
  createPermissionGroup: {
    contract: v2CreatePermissionGroupContract,
    summary: 'Create permission group',
    description:
      'Create a permission group. A non-default group requires workspaces and initially governs everyone in them. Creating a default group demotes the previous default to an inactive group until it is assigned workspaces. Overlapping all-member scopes conflict. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/route').then(
        (route) => route.POST
      ),
  },
  createSandbox: {
    contract: v2CreateSandboxContract,
    summary: 'Create sandbox',
    description:
      'Create a uniquely named dependency environment. Requires workspace Admin access and a configured remote Function runtime. With billing enabled, Max or Enterprise is required unless deployment entitlement overrides it; billing-disabled deployments require sandbox entitlement. Poll Get sandbox for `buildStatus`; `null` means no image build is needed. Invalid dependencies return `400` with field details. Creates and updates share a rate limit; respect `Retry-After`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/route').then((route) => route.POST),
  },
  createServiceAccountCredential: {
    contract: v2CreateServiceAccountCredentialContract,
    summary: 'Create service-account credential',
    description:
      'Verify and store a service-account credential. Use the fields from List credential providers, encoded as a JSON object string in `credentials`. Requires workspace write access. A matching source returns the existing credential with `200`; creation returns `201`. Stored secrets are omitted from the response. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/credentials/route').then((route) => route.POST),
  },
  createSkill: {
    contract: v2CreateSkillContract,
    summary: 'Create skill',
    description:
      'Create a workspace skill with a unique kebab-case name that is not reserved by a built-in skill. Requires workspace write access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/route').then((route) => route.POST),
  },
  createTable: {
    contract: v2CreateTableContract,
    summary: 'Create table',
    description:
      'Create a table with a typed column schema and optional folder placement.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/route').then((route) => route.POST),
  },
  createTableDispatch: {
    contract: v2CreateTableDispatchContract,
    summary: 'Create run dispatch',
    description:
      'Start workflow or enrichment groups across all rows or selected rows. Poll Get run dispatch until `complete` or `canceled`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`. Use Cancel run dispatch to stop further scheduling.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/route').then((route) => route.POST),
  },
  createTableExport: {
    contract: v2CreateTableExportContract,
    summary: 'Create table export',
    description:
      'Create a CSV or JSON export. Exports of small tables finish during the request; larger exports run asynchronously.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/route').then((route) => route.POST),
  },
  createTableFolder: {
    contract: v2CreateTableFolderContract,
    summary: 'Create folder',
    description:
      'Create one table-folder leaf whose parent path already exists.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.POST),
  },
  createTableImport: {
    contract: v2CreateTableImportContract,
    summary: 'Create table import',
    description:
      'Create a CSV import. Upload sources receive signed transfer instructions; workspace-file sources start processing directly.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/imports/route').then((route) => route.POST),
  },
  createTableImportPartUrls: {
    contract: v2CreateTableImportPartUrlsContract,
    summary: 'Create table import part URLs',
    description:
      'Create signed URLs for multipart upload parts. Requires the `uploading` state; other states return `409`. Unknown or purged imports return `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/parts/route').then((route) => route.POST),
  },
  createTableRows: {
    contract: v2CreateTableRowsContract,
    summary: 'Create rows',
    description:
      'Insert one row with a data object or insert a bounded batch with a rows array. Cell keys are column names.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.POST),
  },
  createTableView: {
    contract: v2CreateTableViewContract,
    summary: 'Create view',
    description:
      'Save a filter, sort, and column layout as a named presentation of a table.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/views/route').then((route) => route.POST),
  },
  createWorkflow: {
    contract: v2CreateWorkflowContract,
    summary: 'Create workflow',
    description:
      'Create an undeployed workflow at the workspace root or in a workflow folder. Requires workspace write access.\n\nThe response includes the seeded start block and its ID for connecting other blocks. A name already used in the destination folder returns `409`. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/route').then((route) => route.POST),
  },
  createWorkflowFolder: {
    contract: v2CreateWorkflowFolderContract,
    summary: 'Create workflow folder',
    description:
      'Create a workflow folder at a non-root path with workspace write access. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.POST),
  },
  createWorkflowMcpServer: {
    contract: v2CreateWorkflowMcpServerContract,
    summary: 'Create workflow MCP server',
    description:
      'Create an MCP server exposing deployed workflows as tools. Every supplied workflow must already be deployed. With `isPublic: true`, anyone holding the server URL can execute its workflows without a Sim API key. Requires workspace Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/workflow-mcp-servers/route').then((route) => route.POST),
  },
  createWorkspaceAccessRequest: {
    contract: v2CreateWorkspaceAccessRequestContract,
    summary: 'Create workspace access request',
    description:
      'Request access using a target from Discover workspace access requests. Requires access to an organization-owned workspace with requests enabled; external collaborators use their workspace grant. Each requester can have 100 pending requests and submit 100 in 24 hours within the organization. Matching pending requests are reused; an existing request may be closed if access is already available. Permission approvals change the governing group for all affected members. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/access-requests/route').then(
        (route) => route.POST
      ),
  },
  createWorkspaceInvitations: {
    contract: v2CreateWorkspaceInvitationsContract,
    summary: 'Create workspace invitations',
    description:
      'Invite people to a workspace or grant access immediately to existing organization members. Requires workspace Admin access and current invitation eligibility; invitations offering organization Admin membership also require organization Admin access. Recipients are processed independently: inspect `failed` even after HTTP `200`, and inspect invitation status before retrying a delivery failure. Existing access is preserved. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/invitations/route').then((route) => route.POST),
  },
  deleteCredential: {
    contract: v2DeleteCredentialContract,
    summary: 'Disconnect credential',
    description:
      'Disconnect an OAuth or service-account credential and clear its stored workflow, deployment, paused-run, knowledge-connector, and webhook references. Requires credential Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/route').then((route) => route.DELETE),
  },
  deleteCustomTool: {
    contract: v2DeleteCustomToolContract,
    summary: 'Delete custom tool',
    description:
      'Delete a custom tool. Agent blocks retain their configuration but can no longer call the deleted tool. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.DELETE),
  },
  deleteFile: {
    contract: v2DeleteFileContract,
    summary: 'Delete file',
    description:
      'Archive a workspace file, retaining its stored bytes and removing API read access. List files with `scope=archived` finds it; Restore file recovers it. Archiving an already archived file returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/route').then((route) => route.DELETE),
  },
  deleteFileFolder: {
    contract: v2DeleteFileFolderContract,
    summary: 'Delete folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its files and subfolders. Use Restore folder to recover the archived contents.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.DELETE),
  },
  deleteFileVersion: {
    contract: v2DeleteFileVersionContract,
    summary: 'Delete file version',
    description:
      'Permanently remove an earlier version from history and schedule deletion of its stored content. Storage cleanup may retry in the background. The current version returns `409`; revert to another version first. A version that does not exist returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/route').then((route) => route.DELETE),
  },
  deleteKnowledgeBase: {
    contract: v2DeleteKnowledgeBaseContract,
    summary: 'Delete knowledge base',
    description:
      'Archive a knowledge base, its documents, and its connectors, pausing synchronization. Use List knowledge bases with `scope=archived` to find it and Restore knowledge base to recover it.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.DELETE),
  },
  deleteKnowledgeChunk: {
    contract: v2DeleteKnowledgeChunkContract,
    summary: 'Delete chunk',
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
    summary: 'Delete knowledge connector',
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
    summary: 'Delete document',
    description:
      'Remove a document from listings and search. Uploaded documents and their chunks are deleted. Connector documents are excluded while retaining their stored data; later synchronization does not re-add them.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteKnowledgeFolder: {
    contract: v2DeleteKnowledgeFolderContract,
    summary: 'Delete folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its subfolders and knowledge bases. Use Restore knowledge base to recover knowledge bases.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.DELETE),
  },
  deleteKnowledgeTag: {
    contract: v2DeleteKnowledgeTagContract,
    summary: 'Delete tag',
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
    summary: 'Delete tag definitions',
    description:
      'Delete unused tag definitions by default. With `unused=false`, permanently delete all definitions and their values from documents and chunks. Use Delete tag to remove one definition. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.DELETE),
  },
  deleteMcpServer: {
    contract: v2DeleteMcpServerContract,
    summary: 'Delete MCP server',
    description:
      'Remove an external MCP server and revoke its OAuth tokens. Workflow blocks retain references to its tools, but those tools can no longer be called. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.DELETE),
  },
  deletePermissionGroup: {
    contract: v2DeletePermissionGroupContract,
    summary: 'Delete permission group',
    description:
      'Permanently delete a permission group and its membership assignments. Members then inherit any other applicable restrictions. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteSandbox: {
    contract: v2DeleteSandboxContract,
    summary: 'Delete sandbox',
    description:
      'Delete a sandbox. Function blocks using it fail until reconfigured. Requires workspace Admin access and sandbox entitlement: with billing enabled, Max or Enterprise is required unless deployment entitlement overrides it; billing-disabled deployments require sandbox entitlement. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.DELETE),
  },
  deleteSecret: {
    contract: v2DeleteSecretContract,
    summary: 'Delete secret',
    description:
      'Delete a workspace or caller-owned personal secret without returning its value. Workspace secrets require workspace Admin or secret Admin access. Deleting a personal secret removes it for the caller across all workspaces. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/[name]/route').then((route) => route.DELETE),
  },
  deleteSkill: {
    contract: v2DeleteSkillContract,
    summary: 'Delete skill',
    description:
      'Delete a workspace skill. Requires skill editor or workspace Admin access. Built-in skills cannot be deleted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.DELETE),
  },
  deleteSsoProvider: {
    contract: v2DeleteSsoProviderContract,
    summary: 'Delete SSO provider',
    description:
      'Remove an identity provider and clear its primary selection. Requires organization Admin access. Existing accounts, memberships, and sessions remain. Domain sign-in falls back to another verified provider if one remains; use Get SSO policy to inspect whether SSO is still enforced. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/providers/[providerId]/route').then(
        (route) => route.DELETE
      ),
  },
  deleteTable: {
    contract: v2DeleteTableContract,
    summary: 'Delete table',
    description:
      'Archive a table while retaining its rows. Use List tables with `scope=archived` to find it and Restore table to recover it.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.DELETE),
  },
  deleteTableColumn: {
    contract: v2DeleteTableColumnContract,
    summary: 'Delete column',
    description:
      'Delete a column by name while preserving at least one table column.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.DELETE),
  },
  deleteTableFolder: {
    contract: v2DeleteTableFolderContract,
    summary: 'Delete folder',
    description:
      'Archive an empty folder, or set `recursive=true` to archive its tables and subfolders. Use Restore folder to recover the archived contents.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.DELETE),
  },
  deleteTableRow: {
    contract: v2DeleteTableRowContract,
    summary: 'Delete row',
    description: 'Delete one row by identifier.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.DELETE),
  },
  deleteTableRows: {
    contract: v2DeleteTableRowsContract,
    summary: 'Delete rows',
    description:
      'Delete rows by a non-empty predicate or an explicit bounded list of row identifiers.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.DELETE),
  },
  deleteTableView: {
    contract: v2DeleteTableViewContract,
    summary: 'Delete view',
    description:
      'Delete a saved presentation without changing any table rows.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.DELETE),
  },
  deleteWorkflow: {
    contract: v2DeleteWorkflowContract,
    summary: 'Delete workflow',
    description:
      'Archive a workflow and stop its schedules, webhooks, MCP tools, and hosted chat. Requires workspace write access. Find it with List workflows (`scope=archived`) and recover it with Restore workflow. Both `deleted` and `archived` acknowledge archival.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.DELETE),
  },
  deleteWorkflowChatDeployment: {
    contract: v2DeleteWorkflowChatDeploymentContract,
    summary: 'Delete workflow chat deployment',
    description:
      'Remove the hosted chat and release its URL identifier with workspace Admin access. The workflow API deployment remains active; use Undeploy workflow to stop it. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.DELETE
      ),
  },
  deleteWorkflowFolder: {
    contract: v2DeleteWorkflowFolderContract,
    summary: 'Delete workflow folder',
    description:
      "Archive an empty workflow folder with workspace write access. `recursive=true` also archives its subfolders and workflows, stopping the archived workflows' triggers and hosted surfaces. Use Restore workflow to recover workflows.\n\nOAuth scope: `api:write`.",
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.DELETE),
  },
  deleteWorkflowGroup: {
    contract: v2DeleteWorkflowGroupContract,
    summary: 'Delete workflow group',
    description:
      'Delete a workflow group and every table column populated by that group.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.DELETE),
  },
  deleteWorkflowMcpServer: {
    contract: v2DeleteWorkflowMcpServerContract,
    summary: 'Delete workflow MCP server',
    description:
      'Delete a workflow MCP server and stop serving its tools. Its workflows remain deployed and executable through the workflow API. Requires workspace Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.DELETE),
  },
  deployWorkflow: {
    contract: v2DeployWorkflowContract,
    summary: 'Deploy workflow',
    description:
      'Create a deployment version and activate it asynchronously. Requires workspace Admin access. Each accepted deploy creates a new version; retrying after a timeout can create a duplicate. Poll Get workflow deployment for the accepted `latestDeploymentAttempt` before treating the version as live.\n\n`lint` reports advisory findings for this version and never blocks deployment. A conflicting webhook path returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deploy/route').then((route) => route.POST),
  },
  deployWorkflowMcpTool: {
    contract: v2DeployWorkflowMcpToolContract,
    summary: 'Deploy workflow as MCP tool',
    description:
      'Deploy a workflow as an MCP tool using its deployed input schema. The workflow must already be deployed. Each server has at most one tool per workflow; repeating the call replaces the tool and returns `200` with `updated: true`. Requires workspace Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route').then(
        (route) => route.POST
      ),
  },
  discoverOrganizationAccessRequests: {
    contract: v2DiscoverOrganizationAccessRequestsContract,
    summary: 'Discover organization access requests',
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
    summary: 'Discover workspace access requests',
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
    summary: 'Duplicate workflow',
    description:
      "Create an undeployed copy of a workflow's graph and variables in the same workspace. Requires workspace write access. The destination folder and name default to the source; name collisions in the destination are resolved automatically. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/duplicate/route').then((route) => route.POST),
  },
  editFileContent: {
    contract: v2EditFileContentContract,
    summary: 'Edit file content',
    description:
      'Edit part of a UTF-8 file; use Replace file content to replace it entirely. Search-and-replace requires one exact match unless `replaceAll` is true. Anchored modes match trimmed complete lines; their input descriptions specify boundary handling. Non-UTF-8 files return `400`. Concurrent writes return `409`; re-read before retrying.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/content/route').then((route) => route.PATCH),
  },
  executeTool: {
    contract: v2ExecuteToolContract,
    summary: 'Run tool',
    description:
      'Run a built-in tool using published parameter IDs. Requires workspace read access. Sim resolves `credentialId`, hosted keys, and whole-value `{{VAR_NAME}}` references in `user-only` parameters; other values pass through unchanged. Send connected credentials as top-level `credentialId`, not inside `input`. Third-party refusal returns `200` with `status: "failed"`; API failures use the error envelope. Hidden or missing tools return `404`; disallowed integrations return `403` with `error.details.code: INTEGRATION_NOT_ALLOWED`. Hosted-key usage is billed to the workspace. A call that would use a hosted key returns `402` when the workspace exceeds usage or billing limits. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/tools/[toolId]/execute/route').then((route) => route.POST),
  },
  executeWorkflow: {
    contract: v2ExecuteWorkflowContract,
    summary: 'Execute workflow',
    description:
      'Run the active deployment, or set `run.source: "manual"` to run the saved draft. Deployed execution requires workspace read access and OAuth `api:write` scope or an API key; public deployments also allow anonymous synchronous or streamed runs. Manual runs require personal-key or OAuth write access and cannot be async.\n\nUse `async: true` for a queue receipt, or `stream: true` for SSE. For a synchronous run with both flags false, send `Accept: application/x-ndjson` for heartbeat frames and a final frame containing `data`. Timeouts return `200` with `status: "failed"` and `error.code: "TIMEOUT"`; inspect run status. See [Streaming](/workflows/deployment/api#streaming) for event formats. Input descriptions specify compatible modes; invalid combinations return `400`.\n\nSupply `X-Run-Id` to prevent duplicate execution. Reuse returns `409`, without replaying results. A `503` with `error.details.code: "ASYNC_ENQUEUE_AMBIGUOUS"` omits `Retry-After` because the run may already have started. Reconcile using the returned run ID; do not start another run with a new or omitted ID.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/execute/route').then((route) => route.POST),
  },
  exportWorkflow: {
    contract: v2ExportWorkflowContract,
    summary: 'Export workflow',
    description:
      'Export the saved draft as portable workflow data with workspace read access. Registered credential fields and opaque table/tool values are cleared; environment references and ordinary workflow variables remain included. Review other configuration before sharing.\n\nDefault exports clear workspace bindings. Use `includeWorkspaceBindings=true` to retain non-secret bindings for a same-workspace import, or `includeReferences=true` for source identities and field occurrences used by mapped imports. Exporting records an audit event. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/export/route').then((route) => route.GET),
  },
  forkWorkspace: {
    contract: v2ForkWorkspaceContract,
    summary: 'Fork workspace',
    description:
      "Create a child workspace with undeployed drafts of the source's deployed workflows. Requires source workspace Admin access and permission to create a workspace in its organization. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`.\n\nFirst preview the same name and copy choices, then send the returned fingerprint and a stable request ID. The example fingerprint is illustrative. Identical retries return the same committed operation; changed inputs with that ID return `409`. Poll Get workspace operation until selected resource copies finish. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/route').then((route) => route.POST),
  },
  getAuditLog: {
    contract: v2GetAuditLogContract,
    summary: 'Get audit log',
    description:
      'Get one organization audit-log entry. Requires an Enterprise subscription and organization admin or owner access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/audit-logs/[auditLogId]/route').then((route) => route.GET),
  },
  getBillingStatus: {
    contract: v2GetBillingStatusContract,
    summary: 'Get billing status',
    description:
      "Get the current plan, billing standing, credit allowance, and storage quota. Pooled `credits` and `storage` are visible only to callers who can manage the payer's billing; workspace API keys receive null for both. Use List billing logs for credit history.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/billing/status/route').then((route) => route.GET),
  },
  getBlock: {
    contract: v2GetBlockContract,
    summary: 'Get block',
    description:
      "Get a block's fields, conditions, operations, tool schemas, and triggers. Unversioned types resolve to the newest visible version; the returned `id` identifies that version. Hidden or missing blocks return `404`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/blocks/[blockId]/route').then((route) => route.GET),
  },
  getCustomTool: {
    contract: v2GetCustomToolContract,
    summary: 'Get custom tool',
    description:
      'Get a custom tool’s declaration and code by identifier, scoped to its workspace. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.GET),
  },
  getFile: {
    contract: v2GetFileContract,
    summary: 'Get file metadata',
    description:
      'Get file metadata, its public-share configuration, and the version number of its current content. The `share` field is null when the file has never been shared. `currentVersion` identifies the content in List file versions and is the precondition Revert file version accepts.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/metadata/route').then((route) => route.GET),
  },
  getFileShare: {
    contract: v2GetFileShareContract,
    summary: 'Get file share',
    description:
      "Get a file's public-share configuration. An unshared file returns `data: null`; a disabled share returns its configuration with `isActive: false`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/files/[fileId]/share/route').then((route) => route.GET),
  },
  getFileUpload: {
    contract: v2GetFileUploadContract,
    summary: 'Get file upload',
    description:
      "Get an upload session's state to determine whether an interrupted transfer can resume. Requires the signed upload token and current workspace access.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/files/uploads/[uploadId]/route').then((route) => route.GET),
  },
  getFileVersion: {
    contract: v2GetFileVersionContract,
    summary: 'Get file version',
    description:
      'Get one version of a file. A version removed by retention, or one that never existed, returns `404`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/route').then((route) => route.GET),
  },
  getKnowledgeBase: {
    contract: v2GetKnowledgeBaseContract,
    summary: 'Get knowledge base',
    description:
      "Get a knowledge base's metadata and document counts. Inaccessible knowledge bases return `404`. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.GET),
  },
  getKnowledgeChunk: {
    contract: v2GetKnowledgeChunkContract,
    summary: 'Get chunk',
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
    summary: 'Get knowledge connector',
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
    summary: 'Get document',
    description:
      'Get document metadata, processing status, and source connector details.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.GET
      ),
  },
  getKnowledgeImport: {
    contract: v2GetKnowledgeImportContract,
    summary: 'Get knowledge base import',
    description:
      "Get an import's progress and outcome. During `uploading`, the signed upload token is required; omitting it returns `404`.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/knowledge/imports/[importId]/route').then((route) => route.GET),
  },
  getLog: {
    contract: v2GetLogContract,
    summary: 'Get log',
    description:
      "Get a run's workflow graph, trace spans, final output, and cost. Trace spans expire separately, so an empty `traceSpans` array does not prove none were recorded. Expired runs are permanently deleted by retention cleanup. Sim Cloud Free defaults to 30 days from run start; paid plans and billing-disabled deployments have no default expiry. Organization policies and workspace overrides can set an effective window. Billing-disabled cleanup requires enabled data retention. Runs referenced by active pauses are protected from cleanup. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/logs/[runId]/route').then((route) => route.GET),
  },
  getLogStats: {
    contract: v2GetLogStatsContract,
    summary: 'Get log statistics',
    description:
      'Get bucketed run counts, success rate, errors, and mean latency for the workspace and individual workflows. Query fields describe window selection and bucketing. Folder filters cover subtrees. Expired runs are permanently deleted by retention cleanup. Sim Cloud Free defaults to 30 days from run start; paid plans and billing-disabled deployments have no default expiry. Organization policies and workspace overrides can set an effective window. Billing-disabled cleanup requires enabled data retention. Runs referenced by active pauses are protected from cleanup. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/logs/stats/route').then((route) => route.GET),
  },
  getMcpServer: {
    contract: v2GetMcpServerContract,
    summary: 'Get MCP server',
    description:
      'Get a registered external MCP server. Request-header values and OAuth client secrets are omitted. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.GET),
  },
  getMeta: {
    contract: v2GetMetaContract,
    summary: 'Get API status',
    description:
      'Get the calling credential’s type and expiry. Requires a valid API key or OAuth access token. `v2Enabled` is true whenever this endpoint is served; the response does not enumerate resource permissions.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/meta/route').then((route) => route.GET),
  },
  getNextKnowledgeTagSlot: {
    contract: v2GetNextKnowledgeTagSlotContract,
    summary: 'Get next tag slot',
    description:
      'Get the next available slot and remaining capacity for a field type. This does not reserve a slot. Create tag selects a free slot when `tagSlot` is omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot/route').then(
        (route) => route.GET
      ),
  },
  getOrganization: {
    contract: v2GetOrganizationContract,
    summary: 'Get organization',
    description:
      'Get organization metadata and the acting user’s organization role. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/route').then((route) => route.GET),
  },
  getOrganizationAccessRequestSettings: {
    contract: v2GetOrganizationAccessRequestSettingsContract,
    summary: 'Get organization access request settings',
    description:
      'Get whether the organization allows new access requests and approvals. This preference does not enable features unavailable in the deployment or subscription. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/settings/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationInvitation: {
    contract: v2GetOrganizationInvitationContract,
    summary: 'Get organization invitation',
    description:
      'Get an invitation owned by the organization. Requires organization Admin access. Use List organization invitation workspaces to inspect its workspace grants. The response excludes the acceptance token. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationMemberUsageLimit: {
    contract: v2GetOrganizationMemberUsageLimitContract,
    summary: 'Get organization member credit limit',
    description:
      'Read a person’s credit cap and credits consumed in the organization billing period. Hosted deployments only. The `userId` identifies an organization member or external collaborator with workspace access in this organization; it is not a membership record ID. Null means no per-person cap, while organization limits still apply. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/usage-limit/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationUsageBreakdown: {
    contract: v2GetOrganizationUsageBreakdownContract,
    summary: 'Get organization usage breakdown',
    description:
      'Read ranked usage by member, workspace, workflow, model, BYOK provider, or source. Requires organization Admin access and Usage Monitoring. `other` summarizes groups omitted by the limit. BYOK ranks tokens; other dimensions rank cost. More than 10,000 underlying groups returns `413`; narrow the window or workspace. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/breakdown/route').then(
        (route) => route.GET
      ),
  },
  getOrganizationUsageSummary: {
    contract: v2GetOrganizationUsageSummaryContract,
    summary: 'Get organization usage summary',
    description:
      'Read pooled credits, a usage series, and an exact previous-period comparison when available. Requires organization Admin access and Usage Monitoring: Enterprise when billing is enabled, or deployment enablement when billing is disabled. Defaults to 30 days. Custom dates include both dates in the selected timezone and cannot exceed 92 days. Billing windows exceeding 366 days are rejected. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/summary/route').then(
        (route) => route.GET
      ),
  },
  getPermissionGroup: {
    contract: v2GetPermissionGroupContract,
    summary: 'Get permission group',
    description:
      'Get a permission group and its resolved settings. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.GET
      ),
  },
  getRowEnrichment: {
    contract: v2GetRowEnrichmentContract,
    summary: 'Get row group run',
    description:
      'Read one row’s workflow or enrichment-group outcome: run state, output cells keyed by column name, and providers in cascade order with status, hosted-key cost, duration, and the matching provider. `runState: null` means never run; `cascade: null` means no breakdown was recorded. Missing tables, rows, or groups return `404`. Run state above 2 MiB returns `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route').then(
        (route) => route.GET
      ),
  },
  getSandbox: {
    contract: v2GetSandboxContract,
    summary: 'Get sandbox',
    description:
      'Get a sandbox’s dependency configuration, current build state, and any build failure. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.GET),
  },
  getSelector: {
    contract: v2GetSelectorContract,
    summary: 'Get selector option',
    description:
      'Get an authorized configuration choice by provider ID and declared context with workspace read access. Returns `data: null` when the option is absent from complete results. Truncated results or pagination limits that prevent verification return `413`; a list-only lookup checks at most 100 pages or 10,000 options. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/selectors/get/route').then((route) => route.POST),
  },
  getSkill: {
    contract: v2GetSkillContract,
    summary: 'Get skill',
    description:
      'Get a workspace or built-in skill, including its full instructions. Built-in skills are read-only. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.GET),
  },
  getSsoPolicy: {
    contract: v2GetSsoPolicyContract,
    summary: 'Get SSO policy',
    description:
      'Get the stored organization SSO requirement and whether it is currently enforced. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/policy/route').then(
        (route) => route.GET
      ),
  },
  getSsoProvider: {
    contract: v2GetSsoProviderContract,
    summary: 'Get SSO provider',
    description:
      'Get an identity provider owned by the organization. Requires organization Admin access. OIDC client secrets are redacted and SAML private keys are omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/providers/[providerId]/route').then(
        (route) => route.GET
      ),
  },
  getTable: {
    contract: v2GetTableContract,
    summary: 'Get table',
    description:
      'Get a table with its metadata, column schema, locks, and current job. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.GET),
  },
  getTableDispatch: {
    contract: v2GetTableDispatchContract,
    summary: 'Get run dispatch',
    description:
      "Get a dispatch's current state. Poll until `complete` or `canceled`; use row reads with `includeRunState` for per-cell outcomes.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route').then(
        (route) => route.GET
      ),
  },
  getTableExport: {
    contract: v2GetTableExportContract,
    summary: 'Get table export',
    description: "Get a table export's progress and status.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/route').then((route) => route.GET),
  },
  getTableImport: {
    contract: v2GetTableImportContract,
    summary: 'Get table import',
    description:
      "Get an import's progress and status. During `uploading`, the signed upload token is required; omitting it returns `404`.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/imports/[importId]/route').then((route) => route.GET),
  },
  getTableRow: {
    contract: v2GetTableRowContract,
    summary: 'Get row',
    description:
      "Get one row by identifier. Set `includeRunState=true` to attach the row's per-workflow-group run outcomes.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.GET),
  },
  getTableView: {
    contract: v2GetTableViewContract,
    summary: 'Get view',
    description: 'Get one saved table view by identifier.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.GET),
  },
  getTool: {
    contract: v2GetToolContract,
    summary: 'Get tool',
    description:
      'Get a built-in tool’s parameters and outputs. An exact visible ID is retained; an unversioned name resolves to the newest visible family version. The returned `id` identifies that tool. Hidden or missing tools return `404`. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tools/[toolId]/route').then((route) => route.GET),
  },
  getWorkflow: {
    contract: v2GetWorkflowContract,
    summary: 'Get workflow',
    description:
      'Get workflow metadata, variables, and trigger input fields from the saved draft. Requires workspace read access. Input fields may differ from the live deployment. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.GET),
  },
  getWorkflowChatDeployment: {
    contract: v2GetWorkflowChatDeploymentContract,
    summary: 'Get workflow chat deployment',
    description:
      "Get a workflow's hosted chat and visitor access settings with workspace Admin access. A missing chat returns `404`. Passwords are never returned; `hasPassword` reports whether one is set. Hosted chat and workflow API deployment are managed separately. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.GET
      ),
  },
  getWorkflowDeployment: {
    contract: v2GetWorkflowDeploymentContract,
    summary: 'Get workflow deployment',
    description:
      "Read live deployment status, the latest attempt's readiness or failure, and draft divergence (`needsRedeployment`). Requires workspace read access. `isPublicApi` reports anonymous billed execution; `webhooks` lists registered delivery URLs.\n\n`/workflows/{workflowId}/deployment` controls overall API executability; `/deployments/chat` controls only the hosted-chat surface. A workflow can remain deployed without a chat.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployment/route').then((route) => route.GET),
  },
  getWorkflowMcpServer: {
    contract: v2GetWorkflowMcpServerContract,
    summary: 'Get workflow MCP server',
    description:
      'Get a workflow MCP server’s metadata and client endpoint. Use List workflow MCP tools for its inventory. Requires workspace read access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.GET),
  },
  getWorkflowRun: {
    contract: v2GetWorkflowRunContract,
    summary: 'Get workflow run',
    description:
      'Read current run state with workspace read access. Request final output and files with `includeOutput`, or block outputs with `selectedOutputs`. Organization permission groups can hide output, files, or cost.\n\n`includeFileBase64` inlines file bytes. A file or the total above 16 MiB returns `413` naming a download path; download large files individually. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/route').then((route) => route.GET),
  },
  getWorkflowState: {
    contract: v2GetWorkflowStateContract,
    summary: 'Get workflow state',
    description:
      'Read the saved editable draft, including blocks, edges, loop and parallel containers, and variables. Requires workspace read access. Configured values are included; use this state with Replace workflow state for same-workspace editing, or Export workflow for portable data with registered credential fields cleared. This read records no audit event; `HEAD` mirrors `GET`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/state/route').then((route) => route.GET),
  },
  getWorkflowVersion: {
    contract: v2GetWorkflowVersionContract,
    summary: 'Get workflow version',
    description:
      'Get a deployment version and its pinned graph with workspace read access. Registered credential fields and opaque table/tool values are cleared. Environment references and ordinary workflow variables remain included; review other configuration before sharing.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/route').then(
        (route) => route.GET
      ),
  },
  getWorkspace: {
    contract: v2GetWorkspaceContract,
    summary: 'Get workspace',
    description:
      'Get metadata for a workspace the calling credential can access. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workspaces/[workspaceId]/route').then((route) => route.GET),
  },
  getWorkspaceForkAvailability: {
    contract: v2GetWorkspaceForkAvailabilityContract,
    summary: 'Get workspace fork availability',
    description:
      'Check whether workspace forking is enabled for this deployment and workspace plan. Requires workspace Admin access. Returns `available: false` when the feature gate is unmet. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/availability/route').then(
        (route) => route.GET
      ),
  },
  getWorkspaceForkLineage: {
    contract: v2GetWorkspaceForkLineageContract,
    summary: 'Get workspace fork lineage',
    description:
      'Read this workspace and its direct parent, or `parent: null` when it has no active parent. Requires workspace Admin access. The relationship does not grant access to the parent. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/lineage/route').then((route) => route.GET),
  },
  getWorkspaceForkMappings: {
    contract: v2GetWorkspaceForkMappingsContract,
    summary: 'Get workspace fork mappings',
    description:
      'Read persisted resource mappings in the requested source-to-target direction along a direct fork edge. Requires Admin access to both workspaces. Discover candidates with destination resource reads and selector operations. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/mappings/route').then(
        (route) => route.GET
      ),
  },
  getWorkspaceOperation: {
    contract: v2GetWorkspaceOperationContract,
    summary: 'Get workspace operation',
    description:
      'Read a committed operation and refresh its copy progress, exact admitted deployment readiness, and structured issues with workspace read access. `applied: true` means the transaction committed even if follow-up work failed. This read does not require the fork-specific Admin role or feature gate.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/operations/[operationId]/route').then(
        (route) => route.GET
      ),
  },
  getWorkspacePermissionConfig: {
    contract: v2GetWorkspacePermissionConfigContract,
    summary: 'Get workspace permission config',
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
    summary: 'Grant skill editor',
    description:
      'Grant skill editor access to a current workspace member by email. Requires an existing skill editor or workspace Admin. Workspace Admins already have derived access and cannot receive explicit grants. Existing grants return `200`; new grants return `201`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.POST),
  },
  importWorkflow: {
    contract: v2ImportWorkflowContract,
    summary: 'Import workflow',
    description:
      'Create an undeployed workflow from a portable export object, bare draft state, or JSON string. Requires workspace write access. The empty-state example creates a draft that needs runnable blocks before execution.\n\nMapped imports require a preview with the same choices, its `previewFingerprint`, and a stable `requestId`. Unresolved required configuration creates nothing. Identical retries return the committed result; reusing the ID with changed inputs returns `409`. The result includes regenerated graph IDs and an operation receipt. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/import/route').then((route) => route.POST),
  },
  listAuditLogs: {
    contract: v2ListAuditLogsContract,
    summary: 'List audit logs',
    description:
      'List an organization audit trail with filters and opaque cursor pagination. Requires an Enterprise subscription and organization admin or owner access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/audit-logs/route').then((route) => route.GET),
  },
  listBillingLogs: {
    contract: v2ListBillingLogsContract,
    summary: 'List billing logs',
    description:
      'List credit usage with source filtering and cursor pagination. The default `period` is `30d`; pagination covers only the selected time window. An inverted custom window returns `400`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/billing/logs/route').then((route) => route.GET),
  },
  listBlocks: {
    contract: v2ListBlocksContract,
    summary: 'List blocks',
    description:
      'List built-in and workspace-deployed blocks visible to the caller. Integration allowlists and preview visibility restrict results. Use `capability=trigger` for workflow starters and Get block or Get tool to resolve operation and tool IDs.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/blocks/route').then((route) => route.GET),
  },
  listChatDeployments: {
    contract: v2ListChatDeploymentsContract,
    summary: 'List chat deployments',
    description:
      "List hosted chats and their URLs with workspace read access and cursor pagination. Filter by `workflowId` for one workflow's chat. The admin-only detail read also includes visitor access settings and customizations. Passwords are never returned; organization permission groups can restrict chat deployment access.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/chat-deployments/route').then((route) => route.GET),
  },
  listConnectorTypes: {
    contract: v2ListConnectorTypesContract,
    summary: 'List connector types',
    description:
      'List connector types from the deployment’s knowledge-base connector registry. Requires workspace read access and Knowledge Base access; workspace integration allowlists and revealed preview blocks do not filter this catalog. Results default to 25 summaries per page. `detail=full` adds configuration fields. Fields with `multi: true` accept `string[]`. For picker/manual-entry pairs, send one value under `canonicalParamId`, not the field’s `id`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/connector-types/route').then((route) => route.GET),
  },
  listCredentialMembers: {
    contract: v2ListCredentialMembersContract,
    summary: 'List credential members',
    description:
      'List explicit credential grants, including revoked grants, and inherited workspace Admin access. Personal API keys and OAuth access tokens can list grants for OAuth or service-account credentials. Requires workspace read access and the `integrations.manage` capability. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/members/route').then((route) => route.GET),
  },
  listCredentialProviders: {
    contract: v2ListCredentialProvidersContract,
    summary: 'List credential providers',
    description:
      'List OAuth and service-account connection methods and their availability. OAuth options provide provider IDs for browser connections; service-account methods declare required fields and write-only secrets. Supports provider-name search. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/credentials/providers/route').then((route) => route.GET),
  },
  listCredentials: {
    contract: v2ListCredentialsContract,
    summary: 'List credentials',
    description:
      'List OAuth and service-account connections visible to the caller. Requires workspace read access. Stored tokens, keys, and service-account payloads are omitted.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/credentials/route').then((route) => route.GET),
  },
  listCustomTools: {
    contract: v2ListCustomToolsContract,
    summary: 'List custom tools',
    description:
      'List code-backed custom tools in the workspace with cursor pagination. Each entry includes its declaration and implementation. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/custom-tools/route').then((route) => route.GET),
  },
  listFileFolders: {
    contract: v2ListFileFoldersContract,
    summary: 'List folders',
    description:
      'List workspace file folders with parent-path filtering and sorting. Use `scope=archived` to find paths accepted by Restore folder. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.GET),
  },
  listFiles: {
    contract: v2ListFilesContract,
    summary: 'List files',
    description:
      'List active workspace files with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find files available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/route').then((route) => route.GET),
  },
  listFileVersions: {
    contract: v2ListFileVersionsContract,
    summary: 'List file versions',
    description:
      'List the versions of a file, newest first by default. Each write that changes the bytes records one; identical rewrites do not. Collaborative edits, and repeated workflow writes by one author, fold into a version under ten minutes old and written in the last five. Renames and moves are not versions. Retention removes older versions by age and plan but keeps the newest ten, so numbers can have gaps.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/versions/route').then((route) => route.GET),
  },
  listKnowledgeBases: {
    contract: v2ListKnowledgeBasesContract,
    summary: 'List knowledge bases',
    description:
      'List active knowledge bases in a workspace with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find knowledge bases available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/route').then((route) => route.GET),
  },
  listKnowledgeChunks: {
    contract: v2ListKnowledgeChunksContract,
    summary: 'List chunks',
    description:
      'List document chunks with content search, enabled filtering, sorting, and cursor pagination. Tags use slots; use List tags to resolve display names. Documents that have not finished processing return `409` with their current status. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route').then(
        (route) => route.GET
      ),
  },
  listKnowledgeConnectorDocuments: {
    contract: v2ListKnowledgeConnectorDocumentsContract,
    summary: 'List knowledge connector documents',
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
    summary: 'List knowledge connectors',
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
    summary: 'List documents',
    description:
      'List documents with filename search, state and tag filters, sorting, and cursor pagination. Tag values use display names; use List tags to resolve the slots required for writes.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route').then((route) => route.GET),
  },
  listKnowledgeFolders: {
    contract: v2ListKnowledgeFoldersContract,
    summary: 'List folders',
    description:
      'List folders in the knowledge-base folder tree with filtering and sorting. Returns one page; `nextCursor` is always null. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.GET),
  },
  listKnowledgeTags: {
    contract: v2ListKnowledgeTagsContract,
    summary: 'List tags',
    description:
      "List the knowledge base's tag definitions with display names, write slots, and field types. Filters and document reads use display names; document writes use slots. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route').then((route) => route.GET),
  },
  listKnowledgeTagUsage: {
    contract: v2ListKnowledgeTagUsageContract,
    summary: 'List tag usage',
    description:
      'Count the documents and chunks with a value for each defined tag. Returns one page; `nextCursor` is always null. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/usage/route').then(
        (route) => route.GET
      ),
  },
  listLogs: {
    contract: v2ListLogsContract,
    summary: 'List logs',
    description:
      'List logs with filters, selectable detail, sorting, and cursor pagination. `includeJobRuns=true` includes chat and Sim-agent jobs only with `sortBy=startedAt`, because other orderings are unsupported. `files` contains only run-produced files; use the files API for input attachments. Expired runs are permanently deleted by retention cleanup. Sim Cloud Free defaults to 30 days from run start; paid plans and billing-disabled deployments have no default expiry. Organization policies and workspace overrides can set an effective window. Billing-disabled cleanup requires enabled data retention. Runs referenced by active pauses are protected from cleanup. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/logs/route').then((route) => route.GET),
  },
  listMcpServers: {
    contract: v2ListMcpServersContract,
    summary: 'List MCP servers',
    description:
      'List external MCP servers registered in the workspace. Request-header values and OAuth secrets are omitted. Connection metadata remains at registration defaults until List MCP server tools performs discovery. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/mcp-servers/route').then((route) => route.GET),
  },
  listMcpServerTools: {
    contract: v2ListMcpServerToolsContract,
    summary: 'List MCP server tools',
    description:
      'Discover tools on an enabled external MCP server and update connection metadata. Discovery is bounded by 1,000 tools, 5 MiB, 50 upstream pages, and 60 seconds; limits or later-page failures can return an unmarked partial inventory. Results are unpaginated and may be cached; `refresh=true` requests fresh discovery. Invalid OAuth returns `409` with `MCP_SERVER_REAUTHORIZATION_REQUIRED`; reauthorize in the browser. Disabled servers and servers requiring a managed Credential Group connection return `409`; unavailable servers return `503`. Requires workspace read access. `HEAD` checks access with the same authorization as `GET` but skips side effects, returning an empty `200` without payload headers on success. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/tools/route').then((route) => route.GET),
  },
  listMyOrganizationAccessRequests: {
    contract: v2ListMyOrganizationAccessRequestsContract,
    summary: 'List my organization access requests',
    description:
      'List the acting user’s organization-level requests and member credit-limit requests, including resolved history. For workspace-scoped requests, use List my workspace access requests. History remains available while requests are disabled. Requires organization membership. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/mine/route').then(
        (route) => route.GET
      ),
  },
  listMyWorkspaceAccessRequests: {
    contract: v2ListMyWorkspaceAccessRequestsContract,
    summary: 'List my workspace access requests',
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
    summary: 'List organization access requests',
    description:
      'List requests across the organization for administrator review. Includes requests from organization members and external workspace collaborators; history remains available while requests are disabled. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationDomains: {
    contract: v2ListOrganizationDomainsContract,
    summary: 'List organization domains',
    description:
      'List the organization’s domain claims with cursor pagination. Requires organization membership. Pending DNS challenge values are returned only to administrators using their own credentials. Organizations without Enterprise domain entitlement return an empty list. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/domains/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationInvitations: {
    contract: v2ListOrganizationInvitationsContract,
    summary: 'List organization invitations',
    description:
      'List invitations owned by the organization, including invitations with workspace grants. Requires organization Admin access. Expired invitations are reported without modifying them. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationInvitationWorkspaces: {
    contract: v2ListOrganizationInvitationWorkspacesContract,
    summary: 'List organization invitation workspaces',
    description:
      "List workspace grants attached to an invitation of any status. Includes archived workspaces still owned by the organization; workspaces moved to another organization are omitted. Requires organization Admin access. These grants describe the invitation, not the invitee's current access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces/route'
      ).then((route) => route.GET),
  },
  listOrganizationMembers: {
    contract: v2ListOrganizationMembersContract,
    summary: 'List organization members',
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
    summary: 'List organizations',
    description:
      'List organizations the acting user belongs to. Organizations that disallow the calling credential are omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/organizations/route').then((route) => route.GET),
  },
  listOrganizationUsageEvents: {
    contract: v2ListOrganizationUsageEventsContract,
    summary: 'List organization usage events',
    description:
      'List usage events, including zero-cost activity. Requires organization Admin access and Usage Monitoring. Defaults to 30 days. Cursors retain the initial reporting window; keep filters and sort unchanged while paging. `sim-chat` covers both chat surfaces. Per-event rounding can yield `credits: 0` with `hasCost: true`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/usage/events/route').then(
        (route) => route.GET
      ),
  },
  listOrganizationWorkspaces: {
    contract: v2ListOrganizationWorkspacesContract,
    summary: 'List organization workspaces',
    description:
      'List active workspaces owned by the organization. Requires organization Admin access; does not require Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/workspaces/route').then(
        (route) => route.GET
      ),
  },
  listPermissionGroupMembers: {
    contract: v2ListPermissionGroupMembersContract,
    summary: 'List permission group members',
    description:
      'List explicit membership assignments in a permission group with cursor pagination. An empty inherit group applies to everyone in its workspaces. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/route'
      ).then((route) => route.GET),
  },
  listPermissionGroups: {
    contract: v2ListPermissionGroupsContract,
    summary: 'List permission groups',
    description:
      'List permission groups in an organization with cursor pagination. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/route').then(
        (route) => route.GET
      ),
  },
  listSandboxes: {
    contract: v2ListSandboxesContract,
    summary: 'List sandboxes',
    description:
      'List reusable dependency environments for Function blocks, including language packages, managed CLIs, and system packages. Requires workspace read access. Existing sandboxes remain visible after a plan downgrade.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/sandboxes/route').then((route) => route.GET),
  },
  listSecrets: {
    contract: v2ListSecretsContract,
    summary: 'List secrets',
    description:
      'List workspace secrets visible to the caller and caller-owned personal secrets. Only workspace secrets marked `unredacted` can include values; every other entry contains metadata only. Requires workspace read access. Personal secrets belong to the caller across workspaces. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/route').then((route) => route.GET),
  },
  listSelector: {
    contract: v2ListSelectorContract,
    summary: 'List selector options',
    description:
      'List authorized workspace configuration choices using the selector key and context from an import or sync preview. Requires workspace read access. Missing OAuth connections require human authorization. Keep workspace, selector, context, and search unchanged while paging; a changed provider page returns `409` and requires restarting without a cursor. Provider pages above 8 MiB return `413`; narrow the search. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/selectors/list/route').then((route) => route.POST),
  },
  listSkillEditors: {
    contract: v2ListSkillEditorsContract,
    summary: 'List skill editors',
    description:
      'List explicit skill editors and workspace Admins with cursor pagination. Built-in skills return an empty list. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.GET),
  },
  listSkills: {
    contract: v2ListSkillsContract,
    summary: 'List skills',
    description:
      'List workspace and built-in skills with cursor pagination. Built-in skills are read-only. Skill bodies are omitted; use Get skill to read content. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/skills/route').then((route) => route.GET),
  },
  listSsoProviders: {
    contract: v2ListSsoProvidersContract,
    summary: 'List SSO providers',
    description:
      'List identity providers owned by the organization. Requires organization Admin access. OIDC client secrets are redacted and SAML private keys are omitted. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/providers/route').then(
        (route) => route.GET
      ),
  },
  listTableDispatches: {
    contract: v2ListTableDispatchesContract,
    summary: 'List run dispatches',
    description:
      'List the run dispatches on one table, most recent first — settled dispatches (`complete`, `canceled`) alongside the ones still in flight, so a run that finished between two polls is still visible next to the `dispatchId` its create returned. Capped at the 100 most recent, so this list is unpaginated and `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/dispatches/route').then((route) => route.GET),
  },
  listTableFolders: {
    contract: v2ListTableFoldersContract,
    summary: 'List folders',
    description:
      'List table folders, optionally limiting results to direct children of a parent path. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.GET),
  },
  listTableRows: {
    contract: v2ListTableRowsContract,
    summary: 'List rows',
    description:
      'List rows in default order with cursor pagination. Pages default to a 5 MiB limit and may contain fewer rows than requested; continue until `nextCursor` is null. Use Query rows for filtering and sorting. `includeRunState=true` adds per-group run outcomes and reduces the row limit.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.GET),
  },
  listTables: {
    contract: v2ListTablesContract,
    summary: 'List tables',
    description:
      'List active tables with folder filtering, search, sorting, and cursor pagination. Use `scope=archived` to find tables available for restoration. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/route').then((route) => route.GET),
  },
  listTableViews: {
    contract: v2ListTableViewsContract,
    summary: 'List views',
    description:
      'List saved table views, omitting references to removed columns. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/views/route').then((route) => route.GET),
  },
  listTools: {
    contract: v2ListToolsContract,
    summary: 'List tools',
    description:
      "List built-in tools exposed by blocks visible to the caller. Use List MCP server tools for an external server's tools and List custom tools for workspace code-backed tools.\n\nOAuth scope: `api:read`.",
    handler: () => import('@/app/api/v2/tools/route').then((route) => route.GET),
  },
  listWorkflowFolders: {
    contract: v2ListWorkflowFoldersContract,
    summary: 'List workflow folders',
    description:
      'List workflow folders with workspace read access, optional parent/name filters, and sorting. Returns one page; `nextCursor` is always null. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.GET),
  },
  listWorkflowGroups: {
    contract: v2ListWorkflowGroupsContract,
    summary: 'List workflow groups',
    description:
      'List the workflow and enrichment groups that can be dispatched for a table. Returns one page; `nextCursor` is always null.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.GET),
  },
  listWorkflowMcpServers: {
    contract: v2ListWorkflowMcpServersContract,
    summary: 'List workflow MCP servers',
    description:
      'List MCP servers that expose deployed workflows to external clients. Use List MCP servers for external servers Sim calls. Requires workspace read access. Tool names share a 2,000-name page limit; when `toolNamesTruncated` is true, `toolCount` and `toolNames` may be incomplete. Use List workflow MCP tools for a server’s bounded inventory. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/workflow-mcp-servers/route').then((route) => route.GET),
  },
  listWorkflowMcpTools: {
    contract: v2ListWorkflowMcpToolsContract,
    summary: 'List workflow MCP tools',
    description:
      'List tool registrations ordered by name, including the `workflowId` used to remove each registration. Undeploying a workflow makes its registrations `inactive`; redeploying reactivates them. Results are capped at 2,000 tools: `nextCursor` is always null, and `truncated` marks an incomplete inventory that cannot be paginated. Requires workspace read access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route').then((route) => route.GET),
  },
  listWorkflowRuns: {
    contract: v2ListWorkflowRunsContract,
    summary: 'List workflow runs',
    description:
      'List recorded workflow runs with workspace read access, filters, and cursor pagination. Cost can be hidden by organization permission groups. Expired runs are permanently deleted by retention cleanup. Sim Cloud Free defaults to 30 days from run start; paid plans and billing-disabled deployments have no default expiry. Organization policies and workspace overrides can set an effective window. Billing-disabled cleanup requires enabled data retention. Runs referenced by active pauses are protected from cleanup.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/route').then((route) => route.GET),
  },
  listWorkflows: {
    contract: v2ListWorkflowsContract,
    summary: 'List workflows',
    description:
      'List active workflows in a workspace. Requires workspace read access.\n\nUse `scope=archived` to find workflows available for restoration. Filter by folder, deployment, or name; sort and page with the returned cursor. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workflows/route').then((route) => route.GET),
  },
  listWorkflowVersions: {
    contract: v2ListWorkflowVersionsContract,
    summary: 'List workflow versions',
    description:
      'List saved deployment versions, newest first, with workspace read access. Each version pins an immutable graph; its name and release note can be updated.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/route').then((route) => route.GET),
  },
  listWorkspaceForkChildren: {
    contract: v2ListWorkspaceForkChildrenContract,
    summary: 'List workspace fork children',
    description:
      "List this workspace's active direct children, newest first, with cursor pagination. Requires workspace Admin access. A fork relationship does not grant access to a child workspace. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/children/route').then(
        (route) => route.GET
      ),
  },
  listWorkspaceForkResources: {
    contract: v2ListWorkspaceForkResourcesContract,
    summary: 'List workspace fork resources',
    description:
      'List copyable resources of one kind in this workspace with cursor pagination. Requires workspace Admin access. Fork creation uses file IDs; sync copy choices use file storage keys from source references or file resource reads. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/resources/route').then(
        (route) => route.GET
      ),
  },
  listWorkspaceMembers: {
    contract: v2ListWorkspaceMembersContract,
    summary: 'List workspace members',
    description:
      'List effective workspace members, ordered by email, including explicit grants and inherited organization Admin access. Use each member’s `userId` for member administration. Requires workspace read access.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/members/route').then((route) => route.GET),
  },
  listWorkspaceOperations: {
    contract: v2ListWorkspaceOperationsContract,
    summary: 'List workspace operations',
    description:
      'List stored operation receipts newest first with workspace read access. Filter by the original `requestId` to reconcile an uncertain mutation response. Read an individual operation to refresh its copy and deployment readiness. This list does not require the fork-specific Admin role or feature gate.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/operations/route').then((route) => route.GET),
  },
  listWorkspaces: {
    contract: v2ListWorkspacesContract,
    summary: 'List workspaces',
    description:
      'List active workspaces available to the calling credential. Personal API keys and OAuth tokens see accessible workspaces that permit user-held API credentials; a workspace API key sees only its bound workspace. Results use cursor pagination.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/workspaces/route').then((route) => route.GET),
  },
  moveFileItems: {
    contract: v2MoveFileItemsContract,
    summary: 'Move files',
    description:
      'Move up to 1,000 files to a folder path or the workspace root.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/move/route').then((route) => route.POST),
  },
  moveTables: {
    contract: v2MoveTablesContract,
    summary: 'Move tables and folders',
    description:
      'Move up to 100 tables and folders to one destination. Items succeed or fail independently: covered tables are `skipped`, missing items are `notFound`, and lock or cycle failures include reasons in `failed`. An invalid destination rejects the request before any move.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/move/route').then((route) => route.POST),
  },
  moveWorkflows: {
    contract: v2MoveWorkflowsContract,
    summary: 'Move workflows',
    description:
      'Move up to 100 workflows to one folder with workspace write access. Each move succeeds or fails independently; missing, archived, or locked workflows appear in `failed`. Duplicate IDs are ignored. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/move/route').then((route) => route.POST),
  },
  previewOrganizationAccessRequest: {
    contract: v2PreviewOrganizationAccessRequestContract,
    summary: 'Preview organization access request',
    description:
      'Preview the current permission changes, affected group and audience, or member credit cap. Review `canApply`, `changes`, `impact`, and `fingerprint` before resolving. Permission changes affect the entire governing group, not only the requester. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:read`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/preview/route'
      ).then((route) => route.GET),
  },
  previewWorkflowImport: {
    contract: v2PreviewWorkflowImportContract,
    summary: 'Preview workflow import',
    description:
      'Validate destination mappings and configuration with workspace write access, without creating a workflow. The result reports readiness, unresolved fields, discovery instructions, and a fingerprint for mapped import with the same choices. Imported provenance never authorizes or queries a source workspace.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/import/preview/route').then((route) => route.POST),
  },
  previewWorkspaceFork: {
    contract: v2PreviewWorkspaceForkContract,
    summary: 'Preview workspace fork',
    description:
      'Preview deployed workflows and explicitly selected resources for a new child workspace. Requires source workspace Admin access and permission to create a workspace in its organization. The read-only result supplies the fingerprint for Fork workspace with the same choices. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/preview/route').then(
        (route) => route.POST
      ),
  },
  previewWorkspacePull: {
    contract: v2PreviewWorkspacePullContract,
    summary: 'Preview workspace pull',
    description:
      'Preview changes from the other workspace into this workspace along a direct fork edge. Requires Admin access to both workspaces. The plan lists workflows to create, replace, or archive; replacements overwrite target drafts with the source deployment. Proposed mappings are not saved. Dependent choices use source workflow, block, and field IDs. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/pull/preview/route').then(
        (route) => route.POST
      ),
  },
  previewWorkspacePush: {
    contract: v2PreviewWorkspacePushContract,
    summary: 'Preview workspace push',
    description:
      'Preview changes from this workspace into the other workspace along a direct fork edge. Requires Admin access to both workspaces. The plan lists workflows to create, replace, or archive; replacements overwrite target drafts with the source deployment. Proposed mappings are not saved. Dependent choices use source workflow, block, and field IDs. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/push/preview/route').then(
        (route) => route.POST
      ),
  },
  pullWorkspace: {
    contract: v2PullWorkspaceContract,
    summary: 'Pull workspace',
    description:
      'Apply a reviewed sync from the other workspace into this workspace along a direct fork edge. Requires Admin access to both workspaces. Creates unmatched deployed workflows, overwrites mapped target drafts, and archives mapped targets whose sources were deleted or archived. Undeployed sources alone do not archive targets. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`.\n\nSend `confirm: true`, the fingerprint from a preview with identical choices, and a stable request ID. The example hash is illustrative. Changed or unresolved plans return `409` without applying. Identical retries return the committed operation; changed inputs with that ID return `409`. Copies and deployment activation can finish after the transaction commits. Poll Get workspace operation before treating the target as ready. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/pull/route').then((route) => route.POST),
  },
  pushWorkspace: {
    contract: v2PushWorkspaceContract,
    summary: 'Push workspace',
    description:
      'Apply a reviewed sync from this workspace into the other workspace along a direct fork edge. Requires Admin access to both workspaces. Creates unmatched deployed workflows, overwrites mapped target drafts, and archives mapped targets whose sources were deleted or archived. Undeployed sources alone do not archive targets. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`.\n\nSend `confirm: true`, the fingerprint from a preview with identical choices, and a stable request ID. The example hash is illustrative. Changed or unresolved plans return `409` without applying. Identical retries return the committed operation; changed inputs with that ID return `409`. Copies and deployment activation can finish after the transaction commits. Poll Get workspace operation before treating the target as ready. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/push/route').then((route) => route.POST),
  },
  queryRows: {
    contract: v2QueryRowsContract,
    summary: 'Query rows',
    description:
      'Query rows with typed predicates, sorting, and cursor pagination. Omit the predicate to match all rows. Pages default to a 5 MiB limit; continue until `nextCursor` is null. Oversized predicates return `413`. `includeRunState` adds per-group outcomes and reduces the row limit. Counts are read separately and can differ from paged results if rows change.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/query/route').then((route) => route.POST),
  },
  queryRowsCount: {
    contract: v2QueryRowsCountContract,
    summary: 'Count rows',
    description:
      'Count rows matching a typed predicate, or omit the predicate to count all rows. The count is read separately from row pages and can change between requests. Oversized predicates return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/query/count/route').then((route) => route.POST),
  },
  readFileText: {
    contract: v2ReadFileTextContract,
    summary: 'Read file text',
    description:
      'Extract text without changing the file. Accepts its ID or canonical path (`files/<folder>/<name>` or `uploads/<name>` for an unlisted chat upload); the response echoes the read path. Use Unzip file to unpack archives or Download file for original bytes. Unsupported types return `400`, compiling documents return `409`, and oversized files return `413`. `degraded: true` indicates incomplete or synthesized text, such as the legacy `.pptx` fallback; `truncated: true` indicates a parser limit.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/[fileId]/text/route').then((route) => route.GET),
  },
  readFileVersionText: {
    contract: v2ReadFileVersionTextContract,
    summary: 'Read file version text',
    description:
      'Extract the text of one version, exactly as Read file text extracts the current content. Unsupported types return `400`, compiling documents return `409`, and oversized versions return `413`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/text/route').then(
        (route) => route.GET
      ),
  },
  relocateFileFolder: {
    contract: v2RelocateFileFolderContract,
    summary: 'Rename or move folder',
    description:
      'Rename or move a folder and atomically update all descendant paths.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/route').then((route) => route.PATCH),
  },
  relocateKnowledgeFolder: {
    contract: v2RelocateKnowledgeFolderContract,
    summary: 'Rename or move folder',
    description:
      'Rename or move a folder and atomically rewrite descendant paths. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/knowledge/folders/route').then((route) => route.PATCH),
  },
  relocateTableFolder: {
    contract: v2RelocateTableFolderContract,
    summary: 'Rename or move folder',
    description:
      'Rename or move a table folder and update all descendant paths.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/route').then((route) => route.PATCH),
  },
  relocateWorkflowFolder: {
    contract: v2RelocateWorkflowFolderContract,
    summary: 'Rename or move workflow folder',
    description:
      'Rename or move a workflow folder and update descendant paths with workspace write access. An existing destination receives the folder as a child; otherwise the destination is its new full path. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/workflows/folders/route').then((route) => route.PATCH),
  },
  removeCredentialMember: {
    contract: v2RemoveCredentialMemberContract,
    summary: 'Remove credential member',
    description:
      'Revoke an active explicit credential grant. Requires credential Admin access and the `integrations.manage` capability. Inherited workspace Admins cannot be removed; an absent or already-revoked grant returns `404`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/members/[userId]/route').then(
        (route) => route.DELETE
      ),
  },
  removeOrganizationDomain: {
    contract: v2RemoveOrganizationDomainContract,
    summary: 'Remove organization domain',
    description:
      'Remove a domain claim and revoke verified sign-in authority from matching organization providers. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. Existing accounts and memberships remain. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/domains/[domainId]/route').then(
        (route) => route.DELETE
      ),
  },
  removeOrganizationMember: {
    contract: v2RemoveOrganizationMemberContract,
    summary: 'Remove organization member',
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
    summary: 'Remove permission group member',
    description:
      'Remove a member by user identifier. Removing the last member from an inherit group makes it govern everyone in its workspaces; a conflicting all-member group prevents the removal. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/[userId]/route'
      ).then((route) => route.DELETE),
  },
  renameFile: {
    contract: v2RenameFileContract,
    summary: 'Rename file',
    description:
      'Rename a workspace file without changing its containing folder.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/route').then((route) => route.PATCH),
  },
  replaceWorkflowChatDeployment: {
    contract: v2ReplaceWorkflowChatDeploymentContract,
    summary: 'Create or replace workflow chat deployment',
    description:
      "Create or replace a workflow's hosted chat and deploy its saved draft. Requires workspace Admin access. Omitted fields use defaults; customization exceptions are described on their fields.\n\nPassword authentication requires `password`; email or SSO requires non-empty `allowedEmails`. Public authentication lets anyone with the chat URL run it. A duplicate identifier or pending deployment returns `409`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route').then(
        (route) => route.PUT
      ),
  },
  replaceWorkflowState: {
    contract: v2ReplaceWorkflowStateContract,
    summary: 'Replace workflow state',
    description:
      'Replace the draft graph in one write. Requires workspace write access. Concurrent row-locked writes are last-write-wins; IDs owned by another workflow return `409`. Deployments, schedules, and webhook registrations are unchanged. Deploy to serve the edits.\n\nLint is advisory. Use `dryRun=true` to validate without saving, auditing, or notifying collaborators. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/state/route').then((route) => route.PUT),
  },
  resendOrganizationInvitation: {
    contract: v2ResendOrganizationInvitationContract,
    summary: 'Resend organization invitation',
    description:
      'Email an unexpired pending invitation again, renew its expiry, and replace its previous acceptance link. Requires organization Admin access and current invitation eligibility. Retrying sends another email; inspect the invitation after a delivery failure before retrying. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/resend/route'
      ).then((route) => route.POST),
  },
  resolveOrganizationAccessRequest: {
    contract: v2ResolveOrganizationAccessRequestContract,
    summary: 'Resolve organization access request',
    description:
      'Apply a reviewed request or decline it with a reason. Applying requires the preview fingerprint; changed policy or membership returns a conflict. Credit requests also require a higher `newLimitCredits`. Already resolved requests are returned unchanged. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/resolve/route'
      ).then((route) => route.POST),
  },
  restoreFile: {
    contract: v2RestoreFileContract,
    summary: 'Restore file',
    description:
      'Restore a soft-deleted file to its original folder, or the workspace root if that folder was archived. Name collisions add a `_restored` suffix; read `folderPath` and `name` from the response. Already-active files return unchanged, making retries safe. An archived workspace returns `400`; an unresolved name collision returns `409`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/restore/route').then((route) => route.POST),
  },
  restoreFileFolder: {
    contract: v2RestoreFileFolderContract,
    summary: 'Restore folder',
    description:
      'Restore a folder and the files and subfolders archived with it. Use the path from List folders with `scope=archived`. A path that is not archived returns `404`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/folders/restore/route').then((route) => route.POST),
  },
  restoreKnowledgeBase: {
    contract: v2RestoreKnowledgeBaseContract,
    summary: 'Restore knowledge base',
    description:
      'Restore a knowledge base and the documents and connectors archived with it. Active knowledge bases return unchanged without a new audit event. An archived workspace returns `409`; an archived containing folder moves the restored knowledge base to the workspace root. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/restore/route').then((route) => route.POST),
  },
  restoreTable: {
    contract: v2RestoreTableContract,
    summary: 'Restore table',
    description:
      'Restore a table and its archived rows, views, and workflow groups. Active tables return unchanged without a new audit event. Name conflicts may change the returned `name`. Find archived tables with List tables and `scope=archived`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/restore/route').then((route) => route.POST),
  },
  restoreTableFolder: {
    contract: v2RestoreTableFolderContract,
    summary: 'Restore folder',
    description:
      'Restore an archived table folder, its descendants, and tables using its former path. An archived parent moves it to the root; name conflicts may change the returned `path`. Non-archived paths return `404`. Save the path from Delete folder, because List folders does not include archived table folders.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/folders/restore/route').then((route) => route.POST),
  },
  restoreWorkflow: {
    contract: v2RestoreWorkflowContract,
    summary: 'Restore workflow',
    description:
      'Restore an archived workflow and its archived schedules, webhooks, MCP tools, and hosted chat. Requires workspace write access. An active workflow returns `409`. If its folder is archived, the workflow returns to the workspace root. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/restore/route').then((route) => route.POST),
  },
  resumeWorkflow: {
    contract: v2ResumeWorkflowContract,
    summary: 'Resume workflow run',
    description:
      'Resume one human-in-the-loop pause with workspace write access. The resumed attempt receives a new run ID and returns a synchronous result or queue receipt. A run that originally streamed resumes asynchronously through v2; this endpoint returns no SSE stream.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/resume/route').then(
        (route) => route.POST
      ),
  },
  revertFileVersion: {
    contract: v2RevertFileVersionContract,
    summary: 'Revert file version',
    description:
      'Make the content of a version current again by writing it as a new `revert` version, so the revert can itself be reverted. Open editors receive the change. Reverting to the current version writes nothing and returns `reverted: false`. A concurrent write, or an `expectedCurrentVersion` that is no longer current, returns `409`; a version above 100 MiB returns `413`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/files/[fileId]/versions/[version]/revert/route').then(
        (route) => route.POST
      ),
  },
  revertWorkflowVersion: {
    contract: v2RevertWorkflowVersionContract,
    summary: 'Revert workflow to version',
    description:
      'Overwrite the editable draft with a deployment version, discarding current draft edits. Requires workspace Admin access. Use `active` for the live version. The live deployment is unchanged; use Activate workflow version or Rollback workflow to change it. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/revert/route').then(
        (route) => route.POST
      ),
  },
  revokeOrganizationInvitation: {
    contract: v2RevokeOrganizationInvitationContract,
    summary: 'Revoke organization invitation',
    description:
      'Cancel an unexpired pending invitation and all its workspace grants so it can no longer be accepted. Requires organization Admin access. This does not remove a person who already accepted; use Remove organization member for that. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/route').then(
        (route) => route.DELETE
      ),
  },
  revokeSkillEditor: {
    contract: v2RevokeSkillEditorContract,
    summary: 'Revoke skill editor',
    description:
      'Revoke an explicit skill editor grant by email. Requires an existing skill editor or workspace Admin. Workspace Admins have derived access that cannot be revoked. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/skills/[skillId]/editors/route').then((route) => route.DELETE),
  },
  rollbackWorkflow: {
    contract: v2RollbackWorkflowContract,
    summary: 'Rollback workflow',
    description:
      'Activate a previous deployment version asynchronously, defaulting to the preceding active version. Requires workspace Admin access and a deployed workflow. The draft is unchanged. Poll the accepted `latestDeploymentAttempt`. To select a version while undeployed, use Activate workflow version. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/rollback/route').then((route) => route.POST),
  },
  rollbackWorkspaceFork: {
    contract: v2RollbackWorkspaceForkContract,
    summary: 'Rollback workspace fork',
    description:
      'Restore the latest sync into this workspace from the named other workspace using prior deployed versions. Requires target workspace Admin access. A newer sync from another fork edge returns `409`. Arbitrary draft edits and copied resources are not restored or removed. Inspect `pendingActivations`; retry rollback if activation remains unfinished. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/rollback/route').then(
        (route) => route.POST
      ),
  },
  runRowEnrichment: {
    contract: v2RunRowEnrichmentContract,
    summary: 'Run enrichment for one row',
    description:
      'Start one workflow or enrichment group for a table row. Poll Get run dispatch using the returned `dispatchId`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route').then(
        (route) => route.POST
      ),
  },
  saveSsoProvider: {
    contract: v2SaveSsoProviderContract,
    summary: 'Save SSO provider',
    description:
      'Create or update an organization identity provider’s configuration on a verified domain. Requires organization Admin access and SSO entitlement. Existing providers return 200; creation returns 201. Omission behavior is field-specific; OIDC’s redacted secret marker preserves the saved secret. Identity changes with linked accounts conflict. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/providers/route').then(
        (route) => route.POST
      ),
  },
  searchFileContent: {
    contract: v2SearchFileContentContract,
    summary: 'Search file content',
    description:
      'Search indexed text in active workspace files and return matching lines with file IDs and line numbers. `folderPaths` limits both results and reported coverage. Missing matches are inconclusive if `complete` is false or `indexStatus.skippedFiles` or `indexStatus.partialFiles` is nonzero. `truncated` means additional matches exist beyond `maxResults`.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/files/search/route').then((route) => route.GET),
  },
  searchKnowledge: {
    contract: v2SearchKnowledgeContract,
    summary: 'Search knowledge',
    description:
      'Search one or more knowledge bases with semantic vector retrieval, optional hybrid full-text retrieval, and structured tag filters. Every result names the `knowledgeBaseId` it came from. A request body over 2 MiB is a `413`. Reranking returns `409` when the stored results cannot pass secret-provenance enforcement.\n\nOAuth scope: `api:read`.',
    handler: () => import('@/app/api/v2/knowledge/search/route').then((route) => route.POST),
  },
  searchTableRows: {
    contract: v2SearchTableRowsContract,
    summary: 'Search rows',
    description:
      'Search cell text for a case-insensitive substring within an optional filtered and sorted view. Returns cell coordinates, not row data; `ordinal` matches the view used by Query rows. Results are unpaginated and capped at 1000. If `truncated` is true, narrow the search or predicate.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/search/route').then((route) => route.POST),
  },
  setPrimarySsoProvider: {
    contract: v2SetPrimarySsoProviderContract,
    summary: 'Set primary SSO provider',
    description:
      'Make a verified organization provider handle sign-in for its domain. Requires organization Admin access. Other providers remain available for testing and later switching. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import(
        '@/app/api/v2/organizations/[organizationId]/sso/providers/[providerId]/primary/route'
      ).then((route) => route.POST),
  },
  setSecret: {
    contract: v2SetSecretContract,
    summary: 'Set secret',
    description:
      'Create or replace a workspace or caller-owned personal secret. New workspace secrets require workspace write access; existing ones require workspace Admin or secret Admin access. Omit `value` to update an existing workspace secret’s metadata; a missing secret returns `404`. Personal secrets always require `value`. This operation returns metadata only; List secrets can reveal permitted workspace values marked `unredacted`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/secrets/[name]/route').then((route) => route.PUT),
  },
  syncKnowledgeConnector: {
    contract: v2SyncKnowledgeConnectorContract,
    summary: 'Sync knowledge connector',
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
    summary: 'Download table export',
    description:
      'Get a short-lived signed download URL for a completed export. Other states return `409`; an unavailable export file returns `404`.\n\nOAuth scope: `api:read`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/exports/[exportId]/download/route').then(
        (route) => route.GET
      ),
  },
  undeployWorkflow: {
    contract: v2UndeployWorkflowContract,
    summary: 'Undeploy workflow',
    description:
      'Deactivate the live workflow version and stop its scheduled and webhook triggers. Requires workspace Admin access and a deployed workflow. Deployed MCP tools become inactive; `archivedMcpTools` identifies them. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deploy/route').then((route) => route.DELETE),
  },
  undeployWorkflowMcpTool: {
    contract: v2UndeployWorkflowMcpToolContract,
    summary: 'Undeploy workflow MCP tool',
    description:
      'Remove an MCP tool registration by its workflow ID. The workflow’s API deployment remains active. Requires workspace Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]/route').then(
        (route) => route.DELETE
      ),
  },
  unlinkWorkspaceFork: {
    contract: v2UnlinkWorkspaceForkContract,
    summary: 'Unlink workspace fork',
    description:
      'Remove the direct fork relationship and its mappings with Admin access to the acting workspace. Existing workflows and resources remain available. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/unlink/route').then((route) => route.POST),
  },
  unzipFile: {
    contract: v2UnzipFileContract,
    summary: 'Unzip file',
    description:
      'Extract a ZIP archive into a new sibling folder and return counts and the destination path. Use List files to inspect its contents. Large archives can take minutes; concurrent extraction of the same archive returns `409`. Size or processing-time limits return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/unzip/route').then((route) => route.POST),
  },
  updateCredential: {
    contract: v2UpdateCredentialContract,
    summary: 'Update credential',
    description:
      'Rename an OAuth or service-account credential, change its description, or rotate a service-account secret. Omitted metadata remains unchanged. Rotation requires the provider’s required secret fields to be resubmitted; it replaces the verified secret while retaining the credential ID. Requires credential Admin access. Provider rejection keeps the old secret and returns `400` with `providerErrorCode`; outages return `503`. Secret fields sent for an OAuth credential return `400`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/route').then((route) => route.PATCH),
  },
  updateCustomTool: {
    contract: v2UpdateCustomToolContract,
    summary: 'Update custom tool',
    description:
      'Update a custom tool. Omitted fields remain unchanged; supplied schemas and code replace the stored versions. Titles must remain unique within the workspace. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/custom-tools/[customToolId]/route').then((route) => route.PATCH),
  },
  updateFileContent: {
    contract: v2UpdateFileContentContract,
    summary: 'Replace file content',
    description:
      'Replace the complete contents of an existing file from UTF-8 or base64 input. A stale `expectedRevision`, or a write that raced this one, returns `409`; re-read before retrying.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/files/[fileId]/content/route').then((route) => route.PUT),
  },
  updateKnowledgeBase: {
    contract: v2UpdateKnowledgeBaseContract,
    summary: 'Update knowledge base',
    description:
      "Update a knowledge base's name, description, chunking configuration, or folder placement. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/route').then((route) => route.PATCH),
  },
  updateKnowledgeChunk: {
    contract: v2UpdateKnowledgeChunkContract,
    summary: 'Update chunk',
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
    summary: 'Update knowledge connector',
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
    summary: 'Update knowledge connector documents',
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
    summary: 'Update document',
    description:
      'Rename a document, change search availability, update tag slots, or requeue processing. Omitted fields remain unchanged; indexing state is read-only. Use List tags to resolve names to slots and Get document for source connector details, which this response omits. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateKnowledgeTag: {
    contract: v2UpdateKnowledgeTagContract,
    summary: 'Update tag',
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
    summary: 'Update MCP server',
    description:
      'Update an external MCP server. Omitted fields remain unchanged unless a field specifies otherwise. Authentication changes revoke its stored OAuth grant and reset connection metadata; use List MCP server tools to reconnect. The endpoint URL is immutable. Requires workspace write access.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/mcp-servers/[mcpServerId]/route').then((route) => route.PATCH),
  },
  updateOrganizationAccessRequestSettings: {
    contract: v2UpdateOrganizationAccessRequestSettingsContract,
    summary: 'Update organization access request settings',
    description:
      'Allow or pause new access requests and approvals. Pausing preserves history, cancellation, and decline, and does not revoke previously granted access. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/access-requests/settings/route').then(
        (route) => route.PATCH
      ),
  },
  updateOrganizationMember: {
    contract: v2UpdateOrganizationMemberContract,
    summary: 'Update organization member',
    description:
      'Change a member’s organization role. Requires organization Admin access. The owner’s role and memberships managed by an identity provider cannot be changed here. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateOrganizationMemberUsageLimit: {
    contract: v2UpdateOrganizationMemberUsageLimitContract,
    summary: 'Update organization member credit limit',
    description:
      'Set or clear a person’s credit cap. Hosted deployments only. The `userId` must identify an organization member or external collaborator with workspace access in this organization. The cap is a nonnegative whole number of credits, not dollars: `0` prevents further credit-consuming usage; `null` removes the per-person cap. Organization limits continue to apply. Retrying the same value is safe. Requires organization Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/members/[userId]/usage-limit/route').then(
        (route) => route.PATCH
      ),
  },
  updatePermissionGroup: {
    contract: v2UpdatePermissionGroupContract,
    summary: 'Update permission group',
    description:
      'Update a permission group. Omitted fields remain unchanged; config keys are patched and supplied arrays replace their lists. Promoting a group to default demotes the previous default; demoting without workspaceIds leaves it inactive. Overlapping member or all-member scopes conflict. Requires organization Admin or owner access and active Access Control. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route').then(
        (route) => route.PATCH
      ),
  },
  updateRowsByFilter: {
    contract: v2UpdateRowsByFilterContract,
    summary: 'Update rows by filter',
    description:
      'Apply the same partial data patch to every row matching a non-empty predicate.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/rows/route').then((route) => route.PATCH),
  },
  updateSandbox: {
    contract: v2UpdateSandboxContract,
    summary: 'Update sandbox',
    description:
      'Update a sandbox; omitted fields stay unchanged and supplied lists replace their contents. Dependency changes may start a build; resending a failed specification retries it. `buildStatus: null` means no image build is needed. Requires workspace Admin access and a configured remote Function runtime. With billing enabled, Max or Enterprise is required unless deployment entitlement overrides it; billing-disabled deployments require sandbox entitlement. Creates and updates share a rate limit; respect `Retry-After`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/sandboxes/[sandboxId]/route').then((route) => route.PATCH),
  },
  updateSkill: {
    contract: v2UpdateSkillContract,
    summary: 'Update skill',
    description:
      'Update a workspace skill. Omitted fields remain unchanged. Requires skill editor or workspace Admin access; workspace write access alone does not grant editor access. Built-in skills cannot be changed. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/skills/[skillId]/route').then((route) => route.PATCH),
  },
  updateSsoPolicy: {
    contract: v2UpdateSsoPolicyContract,
    summary: 'Update SSO policy',
    description:
      'Require or stop requiring SSO on future sign-ins. Requires organization Admin access. Enabling requires SSO entitlement and a verified provider; disabling remains available after entitlement is lost. Existing sessions remain active. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/sso/policy/route').then(
        (route) => route.PATCH
      ),
  },
  updateTable: {
    contract: v2UpdateTableContract,
    summary: 'Update table',
    description:
      'Rename a table, edit its description, or move it to a folder. Fields are saved independently: a failed request may leave partial changes. `error.details.applied` lists saved fields; retry only the remaining fields. If absent, nothing changed. Lock flags are read-only. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.',
    handler: () => import('@/app/api/v2/tables/[tableId]/route').then((route) => route.PATCH),
  },
  updateTableColumn: {
    contract: v2UpdateTableColumnContract,
    summary: 'Update column',
    description:
      'Update a column by name and return the complete schema. Renames update rows, views, and workflow-group references keyed by column ID. Workflow Table blocks keep their authored `filter`, `order`, and `data` JSON unchanged. Bound blocks still referencing the old name appear in `unmigrated`; edit them with Apply Workflow Operations to prevent failures on their next run.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/columns/route').then((route) => route.PATCH),
  },
  updateTableRow: {
    contract: v2UpdateTableRowContract,
    summary: 'Update row',
    description:
      'Merge a partial data patch into one row by identifier.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route').then((route) => route.PATCH),
  },
  updateTableView: {
    contract: v2UpdateTableViewContract,
    summary: 'Update view',
    description:
      'Rename a view, replace or shallow-merge its configuration, or promote it to the table default.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/views/[viewId]/route').then((route) => route.PATCH),
  },
  updateWorkflow: {
    contract: v2UpdateWorkflowContract,
    summary: 'Update workflow',
    description:
      "Update a workflow's name, description, or folder path with workspace write access. Omitted fields remain unchanged; `description: null` clears the description. Workspace folder trees exceeding 10,000 folders return `413`.\n\nOAuth scope: `api:write`.",
    handler: () => import('@/app/api/v2/workflows/[workflowId]/route').then((route) => route.PATCH),
  },
  updateWorkflowGroup: {
    contract: v2UpdateWorkflowGroupContract,
    summary: 'Update workflow group',
    description:
      'Restructure a workflow group, its producer, outputs, or execution behavior. Repointing the group at a different workflow concurrently invalidates the resolved output types and returns `409` — retry the update.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/groups/route').then((route) => route.PATCH),
  },
  updateWorkflowMcpServer: {
    contract: v2UpdateWorkflowMcpServerContract,
    summary: 'Update workflow MCP server',
    description:
      'Update a workflow MCP server’s name, description, or public access. Omitted fields stay unchanged; `description: null` clears the description. With `isPublic: true`, anyone holding its URL can execute its tools without a Sim API key. Deploy or undeploy tools separately. Requires workspace Admin access. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflow-mcp-servers/[serverId]/route').then((route) => route.PATCH),
  },
  updateWorkflowPublicApi: {
    contract: v2UpdateWorkflowPublicApiContract,
    summary: 'Update workflow public API access',
    description:
      'Enable or disable unauthenticated execution of the deployed workflow. Requires workspace Admin access. Enabling lets anyone with the execution URL consume billed usage. Organization sharing restrictions return `403` with `PUBLIC_SHARING_NOT_ALLOWED`. Hosted chat is managed separately. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/deployment/route').then((route) => route.PATCH),
  },
  updateWorkflowVersion: {
    contract: v2UpdateWorkflowVersionContract,
    summary: 'Update workflow version',
    description:
      "Update a deployment version's name or release note with workspace write access. Omitted fields remain unchanged; `description: null` clears the note. The graph and live version are unchanged. Use Activate workflow version to serve it.\n\nOAuth scope: `api:write`.",
    handler: () =>
      import('@/app/api/v2/workflows/[workflowId]/versions/[version]/route').then(
        (route) => route.PATCH
      ),
  },
  updateWorkspaceForkExclusions: {
    contract: v2UpdateWorkspaceForkExclusionsContract,
    summary: 'Update workspace fork exclusions',
    description:
      'Include or exclude selected workflows from fork sync with workspace Admin access. Excluded workflows are skipped as sources and targets. Missing, archived, and unchanged workflow IDs are skipped. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/exclusions/route').then(
        (route) => route.PUT
      ),
  },
  updateWorkspaceForkMappings: {
    contract: v2UpdateWorkspaceForkMappingsContract,
    summary: 'Update workspace fork mappings',
    description:
      'Update mappings along a direct fork edge with Admin access to both workspaces. Destination resource membership and credential provider compatibility are validated. Push maps current-to-other; pull maps other-to-current. Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/workspaces/[workspaceId]/fork/mappings/route').then(
        (route) => route.PUT
      ),
  },
  upsertCredentialMember: {
    contract: v2UpsertCredentialMemberContract,
    summary: 'Upsert credential member',
    description:
      'Grant or change a current workspace member’s credential role. Requires credential Admin access and the `integrations.manage` capability. Revoked grants become active again; inherited workspace Admins cannot be demoted. A new grant returns `201`; an existing grant returns `200`. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/credentials/[credentialId]/members/route').then((route) => route.POST),
  },
  upsertFileShare: {
    contract: v2UpsertFileShareContract,
    summary: 'Enable or disable file share',
    description:
      "Create or update a file's public share. `isActive` is required; other fields describe their behavior when access modes change. Enabling a protected mode on a previously unshared file requires its credential in the same request. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.",
    workspaceKeyUnsupported: true,
    handler: () => import('@/app/api/v2/files/[fileId]/share/route').then((route) => route.PATCH),
  },
  upsertTableRow: {
    contract: v2UpsertTableRowContract,
    summary: 'Upsert row',
    description:
      'Insert a row or replace the row matching a selected unique column. On replacement, omitted columns are cleared; send the complete row. Use Update row for a partial patch.\n\nOAuth scope: `api:write`.',
    handler: () =>
      import('@/app/api/v2/tables/[tableId]/rows/upsert/route').then((route) => route.POST),
  },
  verifyOrganizationDomain: {
    contract: v2VerifyOrganizationDomainContract,
    summary: 'Verify organization domain',
    description:
      'Verify domain ownership through its DNS TXT challenge and grant domain trust to matching organization providers. Requires organization Admin access and, when billing is enabled, Enterprise domain entitlement. Billing-disabled self-hosted deployments may configure operator verification. An already-verified domain is returned unchanged. Workspace API keys return `403`; use a personal API key or scoped OAuth token.\n\nOAuth scope: `api:write`.',
    workspaceKeyUnsupported: true,
    handler: () =>
      import('@/app/api/v2/organizations/[organizationId]/domains/[domainId]/verify/route').then(
        (route) => route.POST
      ),
  },
} as const satisfies Record<string, V2McpOperation>

export type V2McpOperationName = keyof typeof V2_MCP_OPERATIONS
