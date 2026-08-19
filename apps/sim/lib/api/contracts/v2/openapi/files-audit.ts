import { z } from 'zod'
import { v2GetAuditLogContract, v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
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
  v2DownloadFileContract,
  v2GetFileContract,
  v2GetFileShareContract,
  v2ListFileFoldersContract,
  v2ListFilesContract,
  v2MoveFileItemsContract,
  v2RelocateFileFolderContract,
  v2RenameFileContract,
  v2RestoreFileContract,
  v2UpdateFileContentContract,
  v2UpsertFileShareContract,
} from '@/lib/api/contracts/v2/files'
import {
  documentedSchema,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  HEAD_OMITS_PAYLOAD_HEADERS,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  WORKSPACE_ERRORS,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiSuccessMetadata,
} from '@/lib/api/openapi/types'

const FILE_EXAMPLE = {
  id: 'wf_V1StGXR8z5jdHi6BmyT91',
  name: 'data.csv',
  size: 1024,
  type: 'text/csv',
  key: 'workspace/example/data.csv',
  folderPath: '/Engineering',
  uploadedByEmail: 'jane@example.com',
  uploadedAt: '2026-01-15T10:30:00Z',
  updatedAt: '2026-01-15T10:30:00Z',
  deletedAt: null,
} as const

const SHARE_EXAMPLE = {
  id: 'shr_8Hf3kL9wQ2mNpXr6Tz1Vb',
  token: 'share-token-example',
  url: 'https://www.sim.ai/f/share-token-example',
  isActive: true,
  resourceType: 'file',
  resourceId: FILE_EXAMPLE.id,
  authType: 'public',
  hasPassword: false,
  allowedEmails: [],
} as const

const AUDIT_LOG_EXAMPLE = {
  id: 'audit_2c3d4e5f6g',
  workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
  actorName: 'Jane Smith',
  actorEmail: 'jane@example.com',
  action: 'file.uploaded',
  resourceType: 'file',
  resourceId: FILE_EXAMPLE.id,
  resourceName: FILE_EXAMPLE.name,
  description: 'Uploaded file "data.csv" via API',
  metadata: { fileSize: 1024, fileType: 'text/csv' },
  createdAt: '2026-01-15T10:30:00Z',
} as const

function filesOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Files'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}

function auditOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Audit Logs'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListFilesContract,
    filesOperation({
      operationId: 'listFiles',
      summary: 'List Files',
      description: `List workspace files with search, sorting, folder filtering, and opaque cursor pagination. Defaults to active files; pass \`scope=archived\` to page over soft-deleted ones. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of workspace files.' },
    }),
    {
      query: documentedSchema(
        v2ListFilesContract.query,
        'ListFilesQuery',
        'List files query',
        'Filters, sorting, and pagination for a workspace file list.'
      ),
      response: documentedSchema(
        v2ListFilesContract.response.schema,
        'V2FileListResponse',
        'File list response',
        'A cursor-paginated page of workspace files.',
        [{ data: [FILE_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateFileContract,
    filesOperation({
      operationId: 'createFile',
      summary: 'Create File',
      description:
        'Create a workspace file from inline UTF-8 or base64 content. Use an upload session for streamed or larger files.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created file.' },
    }),
    {
      query: v2CreateFileContract.query,
      body: documentedSchema(
        v2CreateFileContract.body,
        'CreateFileRequest',
        'Create file request',
        'Inline content and placement for a new workspace file.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            name: 'notes.md',
            content: '# Notes',
          },
        ]
      ),
      response: documentedSchema(
        v2CreateFileContract.response.schema,
        'V2FileResponse',
        'File response',
        'A single workspace file.',
        [{ data: FILE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateFileUploadContract,
    filesOperation({
      operationId: 'createFileUpload',
      summary: 'Create File Upload',
      description:
        'Create a resumable upload session and receive either a signed PUT URL or multipart instructions.',
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created upload session and transfer instructions.' },
    }),
    {
      query: v2CreateFileUploadContract.query,
      body: documentedSchema(
        v2CreateFileUploadContract.body,
        'CreateFileUploadRequest',
        'Create file upload request',
        'File metadata required to create an upload session.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            name: 'archive.zip',
            contentType: 'application/zip',
            size: 1048576,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateFileUploadContract.response.schema,
        'CreateFileUploadResponse',
        'Create file upload response',
        'Upload session, signed control token, and transfer strategy.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AbortFileUploadContract,
    filesOperation({
      operationId: 'abortFileUpload',
      summary: 'Abort File Upload',
      description: 'Abort an active upload session and release provider-side multipart state.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The aborted upload session.' },
    }),
    {
      params: documentedSchema(
        v2AbortFileUploadContract.params,
        'AbortFileUploadParams',
        'Abort upload path parameters',
        'Upload session selected for abortion.'
      ),
      query: documentedSchema(
        v2AbortFileUploadContract.query,
        'AbortFileUploadQuery',
        'Abort upload query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2AbortFileUploadContract.headers,
        'AbortFileUploadHeaders',
        'Abort upload headers',
        'Signed upload control token.'
      ),
      response: documentedSchema(
        v2AbortFileUploadContract.response.schema,
        'FileUploadResponse',
        'File upload response',
        'Current upload-session state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateFileUploadPartUrlsContract,
    filesOperation({
      operationId: 'createFileUploadPartUrls',
      summary: 'Create File Upload Part URLs',
      description: 'Create signed URLs for a bounded set of multipart upload part numbers.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Signed URLs for the requested upload parts.' },
    }),
    {
      params: documentedSchema(
        v2CreateFileUploadPartUrlsContract.params,
        'FileUploadPartUrlsParams',
        'Upload part URL path parameters',
        'Upload session selected for multipart URL creation.'
      ),
      query: documentedSchema(
        v2CreateFileUploadPartUrlsContract.query,
        'FileUploadPartUrlsQuery',
        'Upload part URL query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2CreateFileUploadPartUrlsContract.headers,
        'FileUploadPartUrlsHeaders',
        'Upload part URL headers',
        'Signed upload control token.'
      ),
      body: documentedSchema(
        v2CreateFileUploadPartUrlsContract.body,
        'CreateFileUploadPartUrlsRequest',
        'Create upload part URLs request',
        'Multipart part numbers requiring signed URLs.',
        [{ partNumbers: [1, 2] }]
      ),
      response: documentedSchema(
        v2CreateFileUploadPartUrlsContract.response.schema,
        'CreateFileUploadPartUrlsResponse',
        'Create upload part URLs response',
        'Signed multipart upload URLs.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CompleteFileUploadContract,
    filesOperation({
      operationId: 'completeFileUpload',
      summary: 'Complete File Upload',
      description:
        'Finalize uploaded bytes, verify provider state, and begin atomic workspace-file registration.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The completed or finalizing upload session.' },
    }),
    {
      params: documentedSchema(
        v2CompleteFileUploadContract.params,
        'CompleteFileUploadParams',
        'Complete upload path parameters',
        'Upload session selected for completion.'
      ),
      query: documentedSchema(
        v2CompleteFileUploadContract.query,
        'CompleteFileUploadQuery',
        'Complete upload query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2CompleteFileUploadContract.headers,
        'CompleteFileUploadHeaders',
        'Complete upload headers',
        'Signed upload control token.'
      ),
      response: documentedSchema(
        v2CompleteFileUploadContract.response.schema,
        'FileUploadResponse',
        'File upload response',
        'Current upload-session state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DownloadFileContract,
    filesOperation({
      operationId: 'downloadFile',
      summary: 'Download File',
      description: `Download the current file bytes from a workspace. A generated document is served as its compiled artifact, so it answers \`409\` while that artifact is still compiling and \`413\` if it renders past the size ceiling. Downloading records an audit event, so it is not a safe read. ${HEAD_MIRRORS_GET} ${HEAD_OMITS_PAYLOAD_HEADERS}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The file bytes.',
        headers: ['Content-Type', 'Content-Disposition', 'Content-Length'],
        contentTypes: ['application/octet-stream'],
      },
    }),
    {
      params: documentedSchema(
        v2DownloadFileContract.params,
        'DownloadFileParams',
        'Download file path parameters',
        'File selected for download.'
      ),
      query: documentedSchema(
        v2DownloadFileContract.query,
        'DownloadFileQuery',
        'Download file query',
        'Workspace scope for the file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteFileContract,
    filesOperation({
      operationId: 'deleteFile',
      summary: 'Delete File',
      description:
        'Archive a workspace file. This is a soft delete: the file stops appearing in the default listing and is no longer readable through the API, but its stored bytes are never removed. Archiving an already-archived file is a `404`, not a no-op. List archived files with `GET /files?scope=archived`, and reverse the delete with `POST /files/{fileId}/restore`.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Deletion confirmation.' },
    }),
    {
      params: documentedSchema(
        v2DeleteFileContract.params,
        'DeleteFileParams',
        'Delete file path parameters',
        'File selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteFileContract.query,
        'DeleteFileQuery',
        'Delete file query',
        'Workspace scope for the file.'
      ),
      response: documentedSchema(
        v2DeleteFileContract.response.schema,
        'V2DeleteFileResponse',
        'Delete file response',
        'Deletion confirmation for one file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RenameFileContract,
    filesOperation({
      operationId: 'renameFile',
      summary: 'Rename File',
      description: 'Rename a workspace file without changing its containing folder.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The renamed file.' },
    }),
    {
      query: v2RenameFileContract.query,
      params: documentedSchema(
        v2RenameFileContract.params,
        'RenameFileParams',
        'Rename file path parameters',
        'File selected for renaming.'
      ),
      body: documentedSchema(
        v2RenameFileContract.body,
        'RenameFileRequest',
        'Rename file request',
        'Workspace scope and new file name.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            name: 'renamed.csv',
          },
        ]
      ),
      response: documentedSchema(
        v2RenameFileContract.response.schema,
        'V2FileResponse',
        'File response',
        'A single workspace file.',
        [{ data: FILE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreFileContract,
    filesOperation({
      operationId: 'restoreFile',
      summary: 'Restore File',
      description:
        'Reverse a soft delete and return the file to the workspace. Not a pure undo: the file comes back at the workspace root, and gains a `_restored` suffix when another file there already holds its name, so read `folderPath` and `name` off the response. Restoring an already-active file returns it unchanged, so a retry is safe. An archived workspace is a `400`, and a name the restore could not free is a `409`.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The file as it exists after the restore.' },
    }),
    {
      query: v2RestoreFileContract.query,
      params: documentedSchema(
        v2RestoreFileContract.params,
        'RestoreFileParams',
        'Restore file path parameters',
        'Archived file selected for restore.'
      ),
      body: documentedSchema(
        v2RestoreFileContract.body,
        'RestoreFileRequest',
        'Restore file request',
        'Workspace scope for the archived file.',
        [{ workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64' }]
      ),
      response: documentedSchema(
        v2RestoreFileContract.response.schema,
        'V2RestoreFileResponse',
        'Restore file response',
        'The restored workspace file, at the root and under its post-restore name.',
        [{ data: { ...FILE_EXAMPLE, name: 'data_restored.csv', folderPath: '/' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetFileContract,
    filesOperation({
      operationId: 'getFile',
      summary: 'Get File Metadata',
      description: 'Return file metadata together with the nullable current public-share state.',
      errors: RESOURCE_ERRORS,
      success: { description: 'File metadata and public-share state.' },
    }),
    {
      params: documentedSchema(
        v2GetFileContract.params,
        'GetFileMetadataParams',
        'Get file metadata path parameters',
        'File whose metadata should be returned.'
      ),
      query: documentedSchema(
        v2GetFileContract.query,
        'GetFileMetadataQuery',
        'Get file metadata query',
        'Workspace scope for the file.'
      ),
      response: documentedSchema(
        v2GetFileContract.response.schema,
        'V2FileMetadataResponse',
        'File metadata response',
        'File metadata enriched with its current nullable public-share state.',
        [
          { data: { ...FILE_EXAMPLE, share: null } },
          { data: { ...FILE_EXAMPLE, share: SHARE_EXAMPLE } },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListAuditLogsContract,
    auditOperation({
      operationId: 'listAuditLogs',
      summary: 'List Audit Logs',
      description: `List an organization audit trail with filters and opaque cursor pagination. Requires an Enterprise subscription and organization admin or owner access. ${WORKSPACE_API_KEY_DENIED}`,
      errors: WORKSPACE_ERRORS,
      success: { description: 'A page of audit-log entries.' },
    }),
    {
      query: documentedSchema(
        v2ListAuditLogsContract.query,
        'ListAuditLogsQuery',
        'List audit logs query',
        'Organization scope, filters, and pagination for the audit trail.'
      ),
      response: documentedSchema(
        v2ListAuditLogsContract.response.schema,
        'V2AuditLogListResponse',
        'Audit-log list response',
        'A cursor-paginated page of audit-log entries.',
        [{ data: [AUDIT_LOG_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetAuditLogContract,
    auditOperation({
      operationId: 'getAuditLog',
      summary: 'Get Audit Log',
      description: `Return one organization audit-log entry. Requires an Enterprise subscription and organization admin or owner access. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested audit-log entry.' },
    }),
    {
      params: documentedSchema(
        v2GetAuditLogContract.params,
        'GetAuditLogParams',
        'Get audit log path parameters',
        'Audit-log entry selected by identifier.'
      ),
      query: documentedSchema(
        v2GetAuditLogContract.query,
        'GetAuditLogQuery',
        'Get audit log query',
        'Organization scope for the audit-log entry.'
      ),
      response: documentedSchema(
        v2GetAuditLogContract.response.schema,
        'V2AuditLogResponse',
        'Audit-log response',
        'A single audit-log entry.',
        [{ data: AUDIT_LOG_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2MoveFileItemsContract,
    filesOperation({
      operationId: 'moveFileItems',
      summary: 'Move Files',
      description: 'Move up to 1,000 files to a canonical folder path or the workspace root.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Count of moved files.' },
    }),
    {
      query: v2MoveFileItemsContract.query,
      body: documentedSchema(
        v2MoveFileItemsContract.body,
        'MoveFileItemsRequest',
        'Move files request',
        'Files and destination selected for a bulk move.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            fileIds: [FILE_EXAMPLE.id],
            targetFolderPath: '/Archive',
          },
        ]
      ),
      response: documentedSchema(
        v2MoveFileItemsContract.response.schema,
        'V2MoveFileItemsResponse',
        'Move files response',
        'Count of files moved by the operation.',
        [{ data: { movedItems: { files: 1 } } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetFileShareContract,
    filesOperation({
      operationId: 'getFileShare',
      summary: 'Get File Share',
      description:
        'Return the nullable current public-share configuration for a file. A file that has never been shared returns `data: null` rather than a 404; a share that was created and later disabled is still returned, with `isActive: false`.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Current nullable file-share state.' },
    }),
    {
      params: documentedSchema(
        v2GetFileShareContract.params,
        'GetFileShareParams',
        'Get file share path parameters',
        'File whose public-share state should be returned.'
      ),
      query: documentedSchema(
        v2GetFileShareContract.query,
        'GetFileShareQuery',
        'Get file share query',
        'Workspace scope for the file.'
      ),
      response: documentedSchema(
        v2GetFileShareContract.response.schema,
        'V2GetFileShareResponse',
        'Get file share response',
        'Current public-share state for a file.',
        [{ data: SHARE_EXAMPLE }, { data: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpsertFileShareContract,
    filesOperation({
      operationId: 'upsertFileShare',
      summary: 'Enable or Disable File Share',
      description: `Create or partially update a server-tokenized public share. Only \`isActive\` is required; each other field states what enabling a mode does to it. Enabling any mode other than \`public\` on a file that has never been shared must carry its credential in the same request. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The updated file share.' },
    }),
    {
      query: v2UpsertFileShareContract.query,
      params: documentedSchema(
        v2UpsertFileShareContract.params,
        'UpsertFileShareParams',
        'Upsert file share path parameters',
        'File whose public-share state should be updated.'
      ),
      body: documentedSchema(
        v2UpsertFileShareContract.body,
        'UpsertFileShareRequest',
        'Upsert file share request',
        'Desired public-share state and access policy.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            isActive: true,
            authType: 'public',
          },
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            isActive: false,
          },
        ]
      ),
      response: documentedSchema(
        v2UpsertFileShareContract.response.schema,
        'V2UpsertFileShareResponse',
        'Upsert file share response',
        'Updated public-share state for a file.',
        [{ data: SHARE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateFileContentContract,
    filesOperation({
      operationId: 'updateFileContent',
      summary: 'Replace File Content',
      description: 'Replace the complete contents of an existing file from UTF-8 or base64 input.',
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The updated file.' },
    }),
    {
      query: v2UpdateFileContentContract.query,
      params: documentedSchema(
        v2UpdateFileContentContract.params,
        'UpdateFileContentParams',
        'Update file content path parameters',
        'File whose contents should be replaced.'
      ),
      body: documentedSchema(
        v2UpdateFileContentContract.body,
        'UpdateFileContentRequest',
        'Update file content request',
        'Workspace scope and complete replacement content.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            content: 'replacement text',
          },
        ]
      ),
      response: documentedSchema(
        v2UpdateFileContentContract.response.schema,
        'V2FileResponse',
        'File response',
        'A single workspace file.',
        [{ data: FILE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkDeleteFilesContract,
    filesOperation({
      operationId: 'bulkDeleteFiles',
      summary: 'Delete Files',
      description: 'Delete up to 1,000 workspace files in one operation.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Count of deleted files.' },
    }),
    {
      query: v2BulkDeleteFilesContract.query,
      body: documentedSchema(
        v2BulkDeleteFilesContract.body,
        'BulkDeleteFilesRequest',
        'Bulk delete files request',
        'Workspace and files selected for deletion.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            fileIds: [FILE_EXAMPLE.id],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkDeleteFilesContract.response.schema,
        'BulkDeleteFilesResponse',
        'Bulk delete files response',
        'Count of files deleted by the operation.',
        [{ data: { deletedItems: { files: 1 } } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListFileFoldersContract,
    filesOperation({
      operationId: 'listFilesFolders',
      summary: 'List Folders',
      description: `List workspace file folders with optional parent-path filtering and sorting. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Workspace file folders.' },
    }),
    {
      query: documentedSchema(
        v2ListFileFoldersContract.query,
        'ListFileFoldersQuery',
        'List file folders query',
        'Workspace scope, filters, and sorting for file folders.'
      ),
      response: documentedSchema(
        v2ListFileFoldersContract.response.schema,
        'FileFolderListResponse',
        'File folder list response',
        'Workspace file folders in the current page.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateFileFolderContract,
    filesOperation({
      operationId: 'createFilesFolder',
      summary: 'Create Folder',
      description: 'Create a canonical folder path in a workspace.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created folder.' },
    }),
    {
      query: v2CreateFileFolderContract.query,
      body: documentedSchema(
        v2CreateFileFolderContract.body,
        'CreateFileFolderRequest',
        'Create file folder request',
        'Workspace and canonical path for a new folder.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            path: '/Engineering',
          },
        ]
      ),
      response: documentedSchema(
        v2CreateFileFolderContract.response.schema,
        'FileFolderResponse',
        'File folder response',
        'A single workspace file folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RelocateFileFolderContract,
    filesOperation({
      operationId: 'relocateFilesFolder',
      summary: 'Rename or Move Folder',
      description: 'Rename or move a folder and atomically rewrite descendant canonical paths.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The relocated folder.' },
    }),
    {
      query: v2RelocateFileFolderContract.query,
      body: documentedSchema(
        v2RelocateFileFolderContract.body,
        'RelocateFileFolderRequest',
        'Relocate file folder request',
        'Current and destination canonical paths for a folder.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            path: '/Engineering',
            destinationPath: '/Archive/Engineering',
          },
        ]
      ),
      response: documentedSchema(
        v2RelocateFileFolderContract.response.schema,
        'FileFolderResponse',
        'File folder response',
        'A single workspace file folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteFileFolderContract,
    filesOperation({
      operationId: 'deleteFilesFolder',
      summary: 'Delete Folder',
      description: 'Delete a folder, optionally including every nested file and folder.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Folder deletion confirmation and deleted item counts.' },
    }),
    {
      query: documentedSchema(
        v2DeleteFileFolderContract.query,
        'DeleteFileFolderQuery',
        'Delete file folder query',
        'Workspace, folder path, and recursive deletion option.'
      ),
      response: documentedSchema(
        v2DeleteFileFolderContract.response.schema,
        'DeleteFileFolderResponse',
        'Delete file folder response',
        'Folder deletion confirmation and deleted item counts.'
      ),
    }
  ),
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

export const filesAuditOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-files-audit.json',
  info: {
    title: 'Sim API v2 — Files & Audit Logs',
    description:
      'Version 2 of the Sim REST API for workspace files, resumable uploads, public shares, and organization audit logs.',
    version: '2.0.0',
    contact: {
      name: 'Sim Support',
      email: 'help@sim.ai',
      url: 'https://www.sim.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Files',
      description: 'Create, upload, download, organize, share, and delete workspace files.',
    },
    {
      name: 'Audit Logs',
      description: 'Query the organization audit trail with Enterprise authorization.',
    },
  ],
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
  headers: {
    'Content-Type': {
      schema: z.string().meta({
        id: 'ContentTypeHeader',
        title: 'Content type',
        description:
          'MIME type of the file, defaulting to application/octet-stream when the stored type is unavailable.',
      }),
    },
    'Content-Disposition': {
      schema: z.string().meta({
        id: 'ContentDispositionHeader',
        title: 'Content disposition',
        description: 'Attachment disposition containing sanitized and RFC 5987 encoded filenames.',
      }),
    },
    'Content-Length': {
      schema: z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .meta({
          id: 'ContentLengthHeader',
          title: 'Content length',
          description: 'File size in bytes.',
        }),
    },
    ...V2_COMMON_HEADERS,
  },
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: withErrorExamples({
    Conflict: { message: 'File already exists' },
  }),
  routes,
})
