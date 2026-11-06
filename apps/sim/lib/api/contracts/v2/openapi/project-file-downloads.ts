import {
  documentedSchema,
  HEAD_MIRRORS_GET,
  HEAD_OMITS_PAYLOAD_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2DownloadProjectFileItemsContract,
  v2ExportProjectFileSnapshotContract,
} from '@/lib/api/contracts/v2/project-file-downloads'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'

export const projectFileDownloadOpenApiRoutes = [
  defineOpenApiRoute(
    v2DownloadProjectFileItemsContract,
    {
      applicationOperation: projectFileOperations.downloadItems,
      operationId: 'downloadProjectFileItems',
      summary: 'Download Project File Items',
      description: `Download selected files and recursive folder contents as one ZIP archive. Duplicate selections are included once. Select at most ${MAX_ZIP_DOWNLOAD_FILES} files in total; archive bytes are bounded. Unknown or archived selections are rejected. Downloads record an audit event. ${WORKSPACE_API_KEY_DENIED} ${HEAD_MIRRORS_GET} ${HEAD_OMITS_PAYLOAD_HEADERS}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Selected files in their Project folder paths.',
        headers: ['Content-Type', 'Content-Disposition', 'Content-Length'],
        contentTypes: ['application/zip'],
      },
    },
    {
      params: documentedSchema(
        v2DownloadProjectFileItemsContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: documentedSchema(
        v2DownloadProjectFileItemsContract.query,
        'DownloadProjectFileItemsQuery',
        'Project archive selection',
        'File and folder identifiers within the Project.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ExportProjectFileSnapshotContract,
    {
      applicationOperation: projectFileOperations.exportSnapshot,
      operationId: 'exportProjectFileSnapshot',
      summary: 'Export Project File Snapshot',
      description: `Export the supplied visible Markdown snapshot without changing the stored file or its history. Readable embedded Project assets are bundled in a ZIP; a snapshot without bundled assets is returned as Markdown. Missing or unreadable assets remain as references. Total bytes are bounded. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Markdown snapshot or its archive with embedded assets.',
        headers: ['Content-Type', 'Content-Disposition', 'Content-Length'],
        contentTypes: ['text/markdown', 'application/zip'],
      },
    },
    {
      params: documentedSchema(
        v2ExportProjectFileSnapshotContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: v2ExportProjectFileSnapshotContract.query,
      body: documentedSchema(
        v2ExportProjectFileSnapshotContract.body,
        'ExportProjectFileSnapshotRequest',
        'Project Markdown snapshot',
        'The visible document content to export.'
      ),
    }
  ),
] as const
