import {
  documentedSchema,
  FULL_SET_LIST,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2CreateProjectFileFolderContract,
  v2ListProjectFileFoldersContract,
  v2RestoreProjectFileFolderContract,
  v2UpdateProjectFileFolderContract,
} from '@/lib/api/contracts/v2/project-file-folders'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const projectFileFolderOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListProjectFileFoldersContract,
    {
      applicationOperation: projectFileOperations.listFolders,
      operationId: 'listProjectFileFolders',
      summary: 'List Project File Folders',
      description: `List the Project folder tree with stable identifiers. Use scope=archived to find folders eligible for restore. ${FULL_SET_LIST} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The complete set of folders in the selected lifecycle scope.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListProjectFileFoldersContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: documentedSchema(
        v2ListProjectFileFoldersContract.query,
        'ListProjectFileFoldersQuery',
        'Project folder list query',
        'Select active, archived, or all folders.'
      ),
      response: documentedSchema(
        v2ListProjectFileFoldersContract.response.schema,
        'V2ProjectFileFolderListResponse',
        'Project folder list response',
        'Folders in their existing manual order; nextCursor is always null.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateProjectFileFolderContract,
    {
      applicationOperation: projectFileOperations.createFolder,
      operationId: 'createProjectFileFolder',
      summary: 'Create Project File Folder',
      description: `Create a folder under an existing parent, or at the Project root when parentId is omitted. Sibling names must be unique. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The created folder and its owner and creator attribution.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateProjectFileFolderContract.params,
        'ProjectFilesParams',
        'Project file collection',
        'The Project that owns the requested files.'
      ),
      query: v2CreateProjectFileFolderContract.query,
      body: documentedSchema(
        v2CreateProjectFileFolderContract.body,
        'CreateProjectFileFolderRequest',
        'Create Project folder request',
        'The folder name and optional parent identifier.'
      ),
      response: documentedSchema(
        v2CreateProjectFileFolderContract.response.schema,
        'V2ProjectFileFolderResponse',
        'Project folder response',
        'One folder with canonical ownership and creator attribution.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateProjectFileFolderContract,
    {
      applicationOperation: projectFileOperations.updateFolder,
      operationId: 'updateProjectFileFolder',
      summary: 'Update Project File Folder',
      description: `Rename, move, or reorder a folder while retaining its identity and descendants. Omitted fields stay unchanged; parentId=null moves the folder to the root. Cross-owner parents and cycles are rejected. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated folder.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpdateProjectFileFolderContract.params,
        'ProjectFileFolderParams',
        'Project folder identity',
        'The Project and folder identifiers.'
      ),
      query: v2UpdateProjectFileFolderContract.query,
      body: documentedSchema(
        v2UpdateProjectFileFolderContract.body,
        'UpdateProjectFileFolderRequest',
        'Update Project folder request',
        'The fields to change on the folder.'
      ),
      response: documentedSchema(
        v2UpdateProjectFileFolderContract.response.schema,
        'V2ProjectFileFolderResponse',
        'Project folder response',
        'One folder with canonical ownership and creator attribution.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreProjectFileFolderContract,
    {
      applicationOperation: projectFileOperations.restoreFolder,
      operationId: 'restoreProjectFileFolder',
      summary: 'Restore Project File Folder',
      description: `Restore an archived folder and the files and subfolders archived with it. Find identifiers with List Project File Folders using scope=archived. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The restored folder and affected item counts.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RestoreProjectFileFolderContract.params,
        'ProjectFileFolderParams',
        'Project folder identity',
        'The Project and folder identifiers.'
      ),
      query: v2RestoreProjectFileFolderContract.query,
      body: documentedSchema(
        v2RestoreProjectFileFolderContract.body,
        'RestoreProjectFileFolderRequest',
        'Restore Project folder request',
        'An empty object; the folder is identified in the path.'
      ),
      response: documentedSchema(
        v2RestoreProjectFileFolderContract.response.schema,
        'V2RestoreProjectFileFolderResponse',
        'Restore Project folder response',
        'The restored folder and affected item counts.'
      ),
    }
  ),
] as const
