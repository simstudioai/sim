import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2AbortProjectFileUploadContract,
  v2CompleteProjectFileUploadContract,
  v2CreateProjectFileUploadContract,
  v2GetProjectFileUploadContract,
  v2GetProjectFileUploadPartUrlsContract,
} from '@/lib/api/contracts/v2/project-file-uploads'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const projectFileUploadOpenApiRoutes = [
  defineOpenApiRoute(
    v2CreateProjectFileUploadContract,
    {
      applicationOperation: projectFileOperations.uploadCreate,
      operationId: 'createProjectFileUpload',
      summary: 'Create Project File Upload',
      description: `Create a resumable Project file upload. The file is registered only after the signed transfer and completion succeed. The original API credential and upload-token are required on every control request. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: { description: 'Create Project File Upload result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CreateProjectFileUploadContract.params,
        'ProjectFilesParams',
        'Project upload identity',
        'The owning Project and, for control operations, the upload session.'
      ),
      query: v2CreateProjectFileUploadContract.query,
      body: documentedSchema(
        v2CreateProjectFileUploadContract.body,
        'ProjectUploadCreateRequest',
        'Create Project File Upload request',
        'The parameters for this upload operation.'
      ),
      response: documentedSchema(
        v2CreateProjectFileUploadContract.response.schema,
        'V2CreateProjectFileUploadResponse',
        'Create Project File Upload response',
        'The authorized upload state or transfer instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetProjectFileUploadContract,
    {
      applicationOperation: projectFileOperations.uploadRead,
      operationId: 'getProjectFileUpload',
      summary: 'Get Project File Upload',
      description: `Read the current state of a Project upload, including its file after completion. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: { description: 'Get Project File Upload result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetProjectFileUploadContract.params,
        'ProjectFileUploadParams',
        'Project upload identity',
        'The owning Project and, for control operations, the upload session.'
      ),
      query: v2GetProjectFileUploadContract.query,
      headers: documentedSchema(
        v2GetProjectFileUploadContract.headers,
        'ProjectUploadTokenHeaders',
        'Project upload control token',
        'The signed token issued at upload creation, in addition to the original API credential.'
      ),
      response: documentedSchema(
        v2GetProjectFileUploadContract.response.schema,
        'V2ProjectFileUploadResponse',
        'Project file upload response',
        'The authorized upload state or transfer instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AbortProjectFileUploadContract,
    {
      applicationOperation: projectFileOperations.uploadCancel,
      operationId: 'abortProjectFileUpload',
      summary: 'Abort Project File Upload',
      description: `Abort a pending Project upload and schedule its unregistered bytes for cleanup. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: { description: 'Abort Project File Upload result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2AbortProjectFileUploadContract.params,
        'ProjectFileUploadParams',
        'Project upload identity',
        'The owning Project and, for control operations, the upload session.'
      ),
      query: v2AbortProjectFileUploadContract.query,
      headers: documentedSchema(
        v2AbortProjectFileUploadContract.headers,
        'ProjectUploadTokenHeaders',
        'Project upload control token',
        'The signed token issued at upload creation, in addition to the original API credential.'
      ),
      response: documentedSchema(
        v2AbortProjectFileUploadContract.response.schema,
        'V2ProjectFileUploadResponse',
        'Project file upload response',
        'The authorized upload state or transfer instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CompleteProjectFileUploadContract,
    {
      applicationOperation: projectFileOperations.uploadComplete,
      operationId: 'completeProjectFileUpload',
      summary: 'Complete Project File Upload',
      description: `Finalize verified bytes and atomically register one Project file. Retrying completion returns the same file without billing twice. Current edit access is checked again. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: { description: 'Complete Project File Upload result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CompleteProjectFileUploadContract.params,
        'ProjectFileUploadParams',
        'Project upload identity',
        'The owning Project and, for control operations, the upload session.'
      ),
      query: v2CompleteProjectFileUploadContract.query,
      headers: documentedSchema(
        v2CompleteProjectFileUploadContract.headers,
        'ProjectUploadTokenHeaders',
        'Project upload control token',
        'The signed token issued at upload creation, in addition to the original API credential.'
      ),
      response: documentedSchema(
        v2CompleteProjectFileUploadContract.response.schema,
        'V2ProjectFileUploadResponse',
        'Project file upload response',
        'The authorized upload state or transfer instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetProjectFileUploadPartUrlsContract,
    {
      applicationOperation: projectFileOperations.uploadParts,
      operationId: 'getProjectFileUploadPartUrls',
      summary: 'Get Project File Upload Part URLs',
      description: `Request signed multipart transfer URLs for an active Project upload. Send exactly the returned transfer headers when uploading each part. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Files'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge', 'UnsupportedMediaType'],
      success: {
        description: 'Get Project File Upload Part URLs result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetProjectFileUploadPartUrlsContract.params,
        'ProjectFileUploadParams',
        'Project upload identity',
        'The owning Project and, for control operations, the upload session.'
      ),
      query: v2GetProjectFileUploadPartUrlsContract.query,
      headers: documentedSchema(
        v2GetProjectFileUploadPartUrlsContract.headers,
        'ProjectUploadTokenHeaders',
        'Project upload control token',
        'The signed token issued at upload creation, in addition to the original API credential.'
      ),
      body: documentedSchema(
        v2GetProjectFileUploadPartUrlsContract.body,
        'ProjectFileUploadPartUrlsRequest',
        'Get Project File Upload Part URLs request',
        'The parameters for this upload operation.'
      ),
      response: documentedSchema(
        v2GetProjectFileUploadPartUrlsContract.response.schema,
        'V2ProjectFileUploadPartUrlsResponse',
        'Get Project File Upload Part URLs response',
        'The authorized upload state or transfer instructions.'
      ),
    }
  ),
]
