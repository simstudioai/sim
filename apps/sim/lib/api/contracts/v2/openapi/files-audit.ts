import { v2GetAuditLogContract, v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import {
  v2AbortFileUploadContract,
  v2BulkDeleteFilesContract,
  v2BulkDownloadFilesContract,
  v2CompleteFileUploadContract,
  v2CreateFileContract,
  v2CreateFileFolderContract,
  v2CreateFileUploadContract,
  v2CreateFileUploadPartUrlsContract,
  v2DeleteFileContract,
  v2DeleteFileFolderContract,
  v2DownloadFileContract,
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
  documentedSchema,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  HEAD_OMITS_PAYLOAD_HEADERS,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_BINARY_DOWNLOAD_HEADERS,
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
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'

const FILE_EXAMPLE = {
  id: 'wf_V1StGXR8z5jdHi6BmyT91',
  webUrl:
    'https://www.sim.ai/workspace/a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64/files/wf_V1StGXR8z5jdHi6BmyT91',
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
      applicationOperation: fileOperations.list,
      operationId: 'listFiles',
      summary: 'List Files',
      description: `List active workspace files with folder filtering, search, sorting, and cursor pagination. Use \`scope=archived\` to find files available for restoration. ${FOLDER_TREE_TOO_LARGE}`,
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
      applicationOperation: fileOperations.create,
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
      applicationOperation: fileOperations.uploadCreate,
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
    v2GetFileUploadContract,
    filesOperation({
      applicationOperation: fileOperations.uploadRead,
      operationId: 'getFileUpload',
      summary: 'Get File Upload',
      description:
        "Get an upload session's state to determine whether an interrupted transfer can resume. Requires the signed upload token and current workspace access.",
      errors: RESOURCE_ERRORS,
      success: { description: 'Current upload-session state.' },
    }),
    {
      params: documentedSchema(
        v2GetFileUploadContract.params,
        'GetFileUploadParams',
        'Get upload path parameters',
        'Upload session selected for reading.'
      ),
      query: documentedSchema(
        v2GetFileUploadContract.query,
        'GetFileUploadQuery',
        'Get upload query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2GetFileUploadContract.headers,
        'GetFileUploadHeaders',
        'Get upload headers',
        'Signed upload control token.'
      ),
      response: documentedSchema(
        v2GetFileUploadContract.response.schema,
        'FileUploadResponse',
        'File upload response',
        'Current upload-session state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AbortFileUploadContract,
    filesOperation({
      applicationOperation: fileOperations.uploadCancel,
      operationId: 'abortFileUpload',
      summary: 'Abort File Upload',
      description:
        'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.',
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
      applicationOperation: fileOperations.uploadParts,
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
      applicationOperation: fileOperations.uploadComplete,
      operationId: 'completeFileUpload',
      summary: 'Complete File Upload',
      description:
        'Finalize an upload and register its workspace file. Repeating a completed upload returns the existing file.',
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
    v2ReadFileTextContract,
    filesOperation({
      applicationOperation: fileOperations.readContent,
      operationId: 'readFileText',
      summary: 'Read File Text',
      description:
        'Extract text without changing the file. Use Unzip File to unpack archives or Download File for original bytes. Unsupported types return `400`, compiling documents return `409`, and oversized files return `413`. `degraded: true` indicates incomplete or synthesized text, including some legacy `.doc` and `.ppt` results; `truncated: true` indicates a parser limit.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The extracted text and its extraction-quality flags.' },
    }),
    {
      params: documentedSchema(
        v2ReadFileTextContract.params,
        'ReadFileTextParams',
        'Read file text path parameters',
        'File selected for text extraction.'
      ),
      query: documentedSchema(
        v2ReadFileTextContract.query,
        'ReadFileTextQuery',
        'Read file text query',
        'Workspace scope and optional source-byte ceiling.'
      ),
      response: documentedSchema(
        v2ReadFileTextContract.response.schema,
        'FileTextResponse',
        'File text response',
        'Text extracted from a workspace file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkDownloadFilesContract,
    filesOperation({
      applicationOperation: fileOperations.download,
      operationId: 'bulkDownloadFiles',
      summary: 'Bulk Download Files',
      description: `Stream selected files and recursive folder contents as a ZIP archive. Each selection parameter and the resolved set allow ${MAX_ZIP_DOWNLOAD_FILES} entries; unmatched paths or excess entries return \`400\`. Total bytes are bounded. Downloads record an audit event. ${HEAD_MIRRORS_GET} ${HEAD_OMITS_PAYLOAD_HEADERS}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The selected files as a zip archive.',
        headers: ['Content-Type', 'Content-Disposition'],
        contentTypes: ['application/zip'],
      },
    }),
    {
      query: documentedSchema(
        v2BulkDownloadFilesContract.query,
        'BulkDownloadFilesQuery',
        'Bulk download files query',
        'Workspace scope and the file and folder selection to archive.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UnzipFileContract,
    filesOperation({
      applicationOperation: fileOperations.extractArchive,
      operationId: 'unzipFile',
      summary: 'Unzip File',
      description:
        'Extract a ZIP archive into a new sibling folder and return counts and the destination path. Use List Files to inspect its contents. Large archives can take minutes; concurrent extraction of the same archive returns `409`. Size or processing-time limits return `413`.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Counts and destination folder for the unpacked archive.' },
    }),
    {
      params: documentedSchema(
        v2UnzipFileContract.params,
        'UnzipFileParams',
        'Unzip file path parameters',
        'Archive selected for unzipping.'
      ),
      query: v2UnzipFileContract.query,
      body: documentedSchema(
        v2UnzipFileContract.body,
        'UnzipFileBody',
        'Unzip file body',
        'Workspace scope for the archive.'
      ),
      response: documentedSchema(
        v2UnzipFileContract.response.schema,
        'FileUnzipResponse',
        'Unzip file response',
        'Counts and destination folder for the unpacked archive.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DownloadFileContract,
    filesOperation({
      applicationOperation: fileOperations.download,
      operationId: 'downloadFile',
      summary: 'Download File',
      description: `Download current file bytes. Generated documents use compiled artifacts, returning \`409\` while compiling and \`413\` above the rendered-size ceiling. Downloading records an audit event. ${HEAD_MIRRORS_GET} ${HEAD_OMITS_PAYLOAD_HEADERS}`,
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
      applicationOperation: fileOperations.delete,
      operationId: 'deleteFile',
      summary: 'Delete File',
      description:
        'Archive a workspace file, retaining its stored bytes and removing API read access. List Files with `scope=archived` finds it; Restore File recovers it. Archiving an already archived file returns `404`.',
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
      applicationOperation: fileOperations.rename,
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
      applicationOperation: fileOperations.restore,
      operationId: 'restoreFile',
      summary: 'Restore File',
      description:
        'Restore an archived file to the workspace root. Name collisions add a `_restored` suffix; use the returned `name` and `folderPath`. An active file returns unchanged. An archived workspace returns `400`; an unresolved name collision returns `409`.',
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
      applicationOperation: fileOperations.readMetadata,
      operationId: 'getFile',
      summary: 'Get File Metadata',
      description:
        'Get file metadata and its public-share configuration. The `share` field is null when the file has never been shared.',
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
      applicationOperation: auditLogOperations.list,
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
      applicationOperation: auditLogOperations.readDetail,
      operationId: 'getAuditLog',
      summary: 'Get Audit Log',
      description: `Get one organization audit-log entry. Requires an Enterprise subscription and organization admin or owner access. ${WORKSPACE_API_KEY_DENIED}`,
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
      applicationOperation: fileOperations.move,
      operationId: 'moveFileItems',
      summary: 'Move Files',
      description: 'Move up to 1,000 files to a folder path or the workspace root.',
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
      applicationOperation: fileOperations.readShare,
      operationId: 'getFileShare',
      summary: 'Get File Share',
      description:
        "Get a file's public-share configuration. An unshared file returns `data: null`; a disabled share returns its configuration with `isActive: false`.",
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
      applicationOperation: fileOperations.updateShare,
      operationId: 'upsertFileShare',
      summary: 'Enable or Disable File Share',
      description: `Create or update a file's public share. \`isActive\` is required; other fields describe their behavior when access modes change. Enabling a protected mode on a previously unshared file requires its credential in the same request. ${WORKSPACE_API_KEY_DENIED}`,
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
    v2EditFileContentContract,
    filesOperation({
      applicationOperation: fileOperations.updateContent,
      operationId: 'editFileContent',
      summary: 'Edit File Content',
      description:
        'Edit part of a UTF-8 file; use Replace File Content to replace it entirely. Search-and-replace requires one exact match unless `replaceAll` is true. Anchored modes match trimmed complete lines; their input descriptions specify boundary handling. Non-UTF-8 files return `400`. Concurrent writes return `409`; re-read before retrying.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'Locked'],
      success: { description: 'The edited file and its new line count.' },
    }),
    {
      query: v2EditFileContentContract.query,
      params: documentedSchema(
        v2EditFileContentContract.params,
        'EditFileContentParams',
        'Edit file content path parameters',
        'File whose contents should be edited.'
      ),
      body: documentedSchema(
        v2EditFileContentContract.body,
        'EditFileContentRequest',
        'Edit file content request',
        'Workspace scope and the change to apply.',
        [
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            edit: {
              mode: 'search_replace',
              search: '- based in NYC',
              content: '- based in SF',
            },
          },
          {
            workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
            edit: {
              mode: 'insert_after',
              anchor: '## Preferences',
              content: '- prefers async updates',
            },
          },
        ]
      ),
      response: documentedSchema(
        v2EditFileContentContract.response.schema,
        'V2EditedFileResponse',
        'Edited file response',
        'A workspace file after an in-place content edit.',
        [{ data: { file: FILE_EXAMPLE, lineCount: 5 } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2SearchFileContentContract,
    filesOperation({
      applicationOperation: fileOperations.searchContent,
      operationId: 'searchFileContent',
      summary: 'Search File Content',
      description:
        'Search indexed text in active workspace files and return matching lines with file IDs and line numbers. `folderPaths` limits both results and reported coverage. Missing matches are inconclusive if `complete` is false or `indexStatus.skippedFiles` or `indexStatus.partialFiles` is nonzero. `truncated` means additional matches exist beyond `maxResults`.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Locked'],
      success: { description: 'Matching lines and the index coverage they were drawn from.' },
    }),
    {
      query: documentedSchema(
        v2SearchFileContentContract.query,
        'SearchFileContentQuery',
        'Search file content query',
        'Workspace scope, the query, and an optional folder scope.'
      ),
      response: documentedSchema(
        v2SearchFileContentContract.response.schema,
        'V2FileSearchResultsResponse',
        'File search results response',
        'Matching lines from indexed workspace file content.',
        [
          {
            data: {
              results: [
                {
                  fileId: 'wf_V1StGXR8z5jdHi6BmyT91',
                  lineNumber: 4,
                  text: '- based in NYC',
                },
              ],
              count: 1,
              truncated: false,
              complete: true,
              indexStatus: {
                readyFiles: 12,
                pendingFiles: 0,
                failedFiles: 0,
                skippedFiles: 0,
                partialFiles: 0,
              },
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateFileContentContract,
    filesOperation({
      applicationOperation: fileOperations.updateContent,
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
      applicationOperation: fileOperations.delete,
      operationId: 'bulkDeleteFiles',
      summary: 'Delete Files',
      description:
        'Archive up to 1,000 workspace files while retaining their stored bytes. Use Restore File to recover each file.',
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
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
      applicationOperation: fileOperations.listFolders,
      operationId: 'listFilesFolders',
      summary: 'List Folders',
      description: `List workspace file folders with parent-path filtering and sorting. Use \`scope=archived\` to find paths accepted by Restore Folder. ${FULL_SET_LIST}`,
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
    v2RestoreFileFolderContract,
    filesOperation({
      applicationOperation: fileOperations.restoreFolder,
      operationId: 'restoreFilesFolder',
      summary: 'Restore Folder',
      description:
        'Restore a folder and the files and subfolders archived with it. Use the path from List Folders with `scope=archived`. A path that is not archived returns `404`.',
      errors: [...RESOURCE_CONFLICT_ERRORS],
      success: { description: 'The restored folder and what it brought back.' },
    }),
    {
      query: v2RestoreFileFolderContract.query,
      body: documentedSchema(
        v2RestoreFileFolderContract.body,
        'RestoreFileFolderRequest',
        'Restore file folder request',
        'Workspace scope and archived folder path.'
      ),
      response: documentedSchema(
        v2RestoreFileFolderContract.response.schema,
        'FileFolderRestoreResponse',
        'Folder restore response',
        'The restored folder and the counts of items it brought back.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateFileFolderContract,
    filesOperation({
      applicationOperation: fileOperations.createFolder,
      operationId: 'createFilesFolder',
      summary: 'Create Folder',
      description: 'Create a folder at the supplied workspace path.',
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
      applicationOperation: fileOperations.updateFolder,
      operationId: 'relocateFilesFolder',
      summary: 'Rename or Move Folder',
      description: 'Rename or move a folder and atomically update all descendant paths.',
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
      applicationOperation: fileOperations.deleteFolder,
      operationId: 'deleteFilesFolder',
      summary: 'Delete Folder',
      description:
        'Archive an empty folder, or set `recursive=true` to archive its files and subfolders. Use Restore Folder to recover the archived contents.',
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
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: { ...V2_BINARY_DOWNLOAD_HEADERS, ...V2_COMMON_HEADERS },
  errorSchema: V2_ERROR_SCHEMA,
  /*
   * One example serves every route in this document, and the routes raise 409
   * for unrelated reasons: a name already taken, a write that lost a race, a
   * generated document still compiling. Enumerating them is wrong for whichever
   * cases the list omits, so this states the SHAPE of the conflict instead.
   * Per-operation examples would need an override on `defineOpenApiRoute`.
   */
  errorResponses: withErrorExamples({
    Conflict: { message: 'The request conflicts with the current resource state' },
    /*
     * The shared example names a workflow, which was accurate while workflows
     * and tables were the only documents carrying a 423. The in-place content
     * edit and content search both do now, so this names what is actually
     * locked here without enumerating the reasons it can be.
     */
    Locked: { message: 'The file or its search index is temporarily locked; retry the request' },
  }),
  routes,
})
