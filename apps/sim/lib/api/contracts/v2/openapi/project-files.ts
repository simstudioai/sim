import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2UnzipProjectFileContract } from '@/lib/api/contracts/v2/project-file-extraction'
import {
  v2ArchiveProjectFileItemsContract,
  v2MoveProjectFileItemsContract,
  v2RenameProjectFileContract,
  v2RestoreProjectFileContract,
} from '@/lib/api/contracts/v2/project-file-lifecycle'
import { v2SearchProjectFileContentContract } from '@/lib/api/contracts/v2/project-file-search'
import {
  v2CreateProjectFileContract,
  v2GetProjectFileMetadataContract,
  v2ListProjectFilesContract,
  v2ReadProjectFileContentContract,
  v2UpdateProjectFileContentContract,
} from '@/lib/api/contracts/v2/project-files'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const projectFileOpenApiRoutes = [
  defineOpenApiRoute(
    v2UnzipProjectFileContract,
    {
      applicationOperation: projectFileOperations.extractArchive,
      operationId: 'unzipProjectFile',
      summary: 'Unzip Project File',
      description: `Extract a ZIP archive into a new sibling folder in the same Project. Use List Project Files to inspect its contents. Concurrent extraction of the same archive returns \`409\`; size or processing-time limits return \`413\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Counts and destination folder for the unpacked archive.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UnzipProjectFileContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2UnzipProjectFileContract.query,
      response: documentedSchema(
        v2UnzipProjectFileContract.response.schema,
        'V2ProjectFileUnzipResponse',
        'Unzip Project file response',
        'Counts and destination folder for the unpacked archive.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SearchProjectFileContentContract,
    {
      applicationOperation: projectFileOperations.searchContent,
      operationId: 'searchProjectFileContent',
      summary: 'Search Project File Content',
      description: `Search indexed text in active Project files, returning matching lines with file IDs and line numbers. Folder filters narrow both results and reported coverage. Missing matches are inconclusive when complete is false, or skippedFiles or partialFiles is nonzero. truncated means additional matches exist beyond maxResults. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'Locked'],
      success: {
        description: 'Matching lines and the index coverage they were drawn from.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2SearchProjectFileContentContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: documentedSchema(
        v2SearchProjectFileContentContract.query,
        'SearchProjectFileContentQuery',
        'Project file search query',
        'The search text, mode, result limit, and optional folder scope.'
      ),
      response: documentedSchema(
        v2SearchProjectFileContentContract.response.schema,
        'V2ProjectFileSearchResultsResponse',
        'File search results response',
        'Matching lines from indexed file content.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RenameProjectFileContract,
    {
      applicationOperation: projectFileOperations.rename,
      operationId: 'renameProjectFile',
      summary: 'Rename Project File',
      description: `Rename a shared Project file while retaining its identity and history. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Metadata for the renamed file.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2RenameProjectFileContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2RenameProjectFileContract.query,
      body: documentedSchema(
        v2RenameProjectFileContract.body,
        'RenameProjectFileRequest',
        'Rename Project File request',
        'The new file name.'
      ),
      response: documentedSchema(
        v2RenameProjectFileContract.response.schema,
        'V2ProjectFileMetadataResponse',
        'Project file metadata response',
        'Metadata for one authorized Project file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2MoveProjectFileItemsContract,
    {
      applicationOperation: projectFileOperations.moveItems,
      operationId: 'moveProjectFileItems',
      summary: 'Move Project File Items',
      description: `Move selected files and folders into an existing folder within the same Project. Folder contents move with their parent. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Counts and identifiers of moved items.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2MoveProjectFileItemsContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: v2MoveProjectFileItemsContract.query,
      body: documentedSchema(
        v2MoveProjectFileItemsContract.body,
        'MoveProjectFileItemsRequest',
        'Move Project File Items request',
        'Selected files and folders and their destination.'
      ),
      response: documentedSchema(
        v2MoveProjectFileItemsContract.response.schema,
        'V2MoveProjectFileItemsResponse',
        'Project file operation response',
        'Counts and identifiers of moved items.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ArchiveProjectFileItemsContract,
    {
      applicationOperation: projectFileOperations.archiveItems,
      operationId: 'archiveProjectFileItems',
      summary: 'Archive Project File Items',
      description: `Archive selected files and folders. Folder contents are archived recursively and remain recoverable until retention removes them. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Counts and identifiers of archived items.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ArchiveProjectFileItemsContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: v2ArchiveProjectFileItemsContract.query,
      body: documentedSchema(
        v2ArchiveProjectFileItemsContract.body,
        'ArchiveProjectFileItemsRequest',
        'Archive Project File Items request',
        'Files and folders to archive.'
      ),
      response: documentedSchema(
        v2ArchiveProjectFileItemsContract.response.schema,
        'V2ArchiveProjectFileItemsResponse',
        'Project file operation response',
        'Counts and identifiers of archived items.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreProjectFileContract,
    {
      applicationOperation: projectFileOperations.restore,
      operationId: 'restoreProjectFile',
      summary: 'Restore Project File',
      description: `Restore an archived Project file. If its former folder is unavailable, restore it to the Project root with an available name. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Metadata for the restored file.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2RestoreProjectFileContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2RestoreProjectFileContract.query,
      body: documentedSchema(
        v2RestoreProjectFileContract.body,
        'RestoreProjectFileRequest',
        'Restore Project file request',
        'An empty object; the file is identified by its path parameters.'
      ),
      response: documentedSchema(
        v2RestoreProjectFileContract.response.schema,
        'V2ProjectFileMetadataResponse',
        'Project file metadata response',
        'Metadata for one authorized Project file.'
      ),
    }
  ),

  defineOpenApiRoute(
    v2CreateProjectFileContract,
    {
      applicationOperation: projectFileOperations.create,
      operationId: 'createProjectFile',
      summary: 'Create Project File',
      description: `Create a shared Project file from inline text or base64 bytes. Names are exact; an existing sibling name returns a conflict. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: {
        description: 'The created file and its content revision.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateProjectFileContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: v2CreateProjectFileContract.query,
      body: documentedSchema(
        v2CreateProjectFileContract.body,
        'CreateProjectFileRequest',
        'Create Project file request',
        'Name, content, encoding, and containing folder within the Project.'
      ),
      response: documentedSchema(
        v2CreateProjectFileContract.response.schema,
        'V2ProjectFileMetadataResponse',
        'Project file metadata response',
        'Metadata for one authorized Project file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ReadProjectFileContentContract,
    {
      applicationOperation: projectFileOperations.readContent,
      operationId: 'readProjectFileContent',
      summary: 'Read Project File Source',
      description: `Read the stored source bytes of a Project file. Generated documents return their generation source; rendered downloads are separate. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The current stored content bytes.',
        headers: ['Content-Type', 'Content-Disposition', 'Content-Length'],
        contentTypes: ['application/octet-stream'],
      },
    },
    {
      params: documentedSchema(
        v2ReadProjectFileContentContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2ReadProjectFileContentContract.query,
    }
  ),
  defineOpenApiRoute(
    v2UpdateProjectFileContentContract,
    {
      applicationOperation: projectFileOperations.updateContent,
      operationId: 'updateProjectFileContent',
      summary: 'Replace Project File Content',
      description: `Replace the complete content of a Project file. Supply expectedRevision to reject a stale edit with 409. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: {
        description: 'The updated file and its content revision.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateProjectFileContentContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2UpdateProjectFileContentContract.query,
      body: documentedSchema(
        v2UpdateProjectFileContentContract.body,
        'UpdateProjectFileContentRequest',
        'Project content replacement',
        'Complete replacement bytes and an optional optimistic concurrency revision.'
      ),
      response: documentedSchema(
        v2UpdateProjectFileContentContract.response.schema,
        'V2ProjectFileMetadataResponse',
        'Project file metadata response',
        'Metadata for one authorized Project file.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListProjectFilesContract,
    {
      applicationOperation: projectFileOperations.list,
      operationId: 'listProjectFiles',
      summary: 'List Project Files',
      description: `List shared Project files with cursor pagination. Use scope=archived to find archived files. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of Project files.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListProjectFilesContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: documentedSchema(
        v2ListProjectFilesContract.query,
        'ListProjectFilesQuery',
        'Project file list query',
        'Filters, sorting, and pagination within one Project.'
      ),
      response: documentedSchema(
        v2ListProjectFilesContract.response.schema,
        'V2ProjectFileListResponse',
        'Project file list response',
        'A page of files owned by the requested Project.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetProjectFileMetadataContract,
    {
      applicationOperation: projectFileOperations.readMetadata,
      operationId: 'getProjectFileMetadata',
      summary: 'Get Project File Metadata',
      description: `Get an active file's metadata and Project ownership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Project file metadata.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetProjectFileMetadataContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2GetProjectFileMetadataContract.query,
      response: documentedSchema(
        v2GetProjectFileMetadataContract.response.schema,
        'V2ProjectFileMetadataResponse',
        'Project file metadata response',
        'Metadata for one authorized Project file.'
      ),
    }
  ),
] as const
