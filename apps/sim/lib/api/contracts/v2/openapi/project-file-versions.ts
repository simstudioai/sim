import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2DeleteProjectFileVersionContract,
  v2GetProjectFileVersionContract,
  v2ListProjectFileVersionsContract,
  v2ReadProjectFileVersionContentContract,
  v2RevertProjectFileVersionContract,
} from '@/lib/api/contracts/v2/project-file-versions'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const projectFileVersionOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListProjectFileVersionsContract,
    {
      applicationOperation: projectFileOperations.listVersions,
      operationId: 'listProjectFileVersions',
      summary: 'List Project File Versions',
      description: `List recorded versions of a shared Project file, newest first by default. Retention follows the Project payer and preserves the newest ten versions; removed versions leave gaps in numbering. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A cursor-paginated page of Project file versions.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListProjectFileVersionsContract.params,
        'ProjectFileParams',
        'Project file identity',
        'The owning Project and the file identifier.'
      ),
      query: documentedSchema(
        v2ListProjectFileVersionsContract.query,
        'ListProjectFileVersionsQuery',
        'List Project file versions query',
        'Sort direction and cursor pagination within this file history.'
      ),
      response: documentedSchema(
        v2ListProjectFileVersionsContract.response.schema,
        'V2ProjectFileVersionListResponse',
        'List Project File Versions response',
        'A cursor-paginated page of Project file versions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetProjectFileVersionContract,
    {
      applicationOperation: projectFileOperations.readVersion,
      operationId: 'getProjectFileVersion',
      summary: 'Get Project File Version',
      description: `Get metadata and author attribution for a recorded Project file version. Missing or permanently removed versions return \`404\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Metadata for the selected version.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetProjectFileVersionContract.params,
        'ProjectFileVersionParams',
        'Project file version identity',
        'The Project, file, and selected version when applicable.'
      ),
      query: v2GetProjectFileVersionContract.query,
      response: documentedSchema(
        v2GetProjectFileVersionContract.response.schema,
        'V2ProjectFileVersionResponse',
        'Get Project File Version response',
        'Metadata for the selected version.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ReadProjectFileVersionContentContract,
    {
      applicationOperation: projectFileOperations.readVersionContent,
      operationId: 'readProjectFileVersionContent',
      summary: 'Read Project File Version Content',
      description: `Read the stored source bytes of a Project file version using the file’s current name. Generated documents return their editable source, rather than a compiled Office or page export. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The selected version’s stored source bytes.',
        headers: RATE_LIMIT_HEADERS,
        contentTypes: ['application/octet-stream'],
      },
    },
    {
      params: documentedSchema(
        v2ReadProjectFileVersionContentContract.params,
        'ProjectFileVersionParams',
        'Project file version identity',
        'The Project, file, and selected version when applicable.'
      ),
      query: v2ReadProjectFileVersionContentContract.query,
    }
  ),
  defineOpenApiRoute(
    v2RevertProjectFileVersionContract,
    {
      applicationOperation: projectFileOperations.revertVersion,
      operationId: 'revertProjectFileVersion',
      summary: 'Revert Project File Version',
      description: `Make an earlier version current by recording its source bytes as a new revert version. Reverting to the current version is a no-op. Use expectedRevision to reject changes made since the last read; a stale revision or concurrent edit returns \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The file and current version after the revert.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RevertProjectFileVersionContract.params,
        'ProjectFileVersionParams',
        'Project file version identity',
        'The Project, file, and selected version when applicable.'
      ),
      query: v2RevertProjectFileVersionContract.query,
      body: documentedSchema(
        v2RevertProjectFileVersionContract.body,
        'RevertProjectFileVersionRequest',
        'Revert Project file version request',
        'Optional revision or current-version preconditions.'
      ),
      response: documentedSchema(
        v2RevertProjectFileVersionContract.response.schema,
        'V2ProjectFileVersionRevertResponse',
        'Revert Project File Version response',
        'The file and current version after the revert.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteProjectFileVersionContract,
    {
      applicationOperation: projectFileOperations.deleteVersion,
      operationId: 'deleteProjectFileVersion',
      summary: 'Delete Project File Version',
      description: `Permanently remove one superseded Project file version from history. Deleting the current version returns \`409\`; other versions and the current file remain available. Stored-object cleanup is retried asynchronously when needed. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Deletion acknowledgement for the superseded version.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DeleteProjectFileVersionContract.params,
        'ProjectFileVersionParams',
        'Project file version identity',
        'The Project, file, and selected version when applicable.'
      ),
      query: v2DeleteProjectFileVersionContract.query,
      response: documentedSchema(
        v2DeleteProjectFileVersionContract.response.schema,
        'V2ProjectFileVersionDeleteResponse',
        'Delete Project File Version response',
        'Deletion acknowledgement for the superseded version.'
      ),
    }
  ),
]
