/** Persisted metadata key shared by credential binding and retired-upload cleanup. */
export const PROJECT_FILE_UPLOAD_BINDING_KEY = 'projectFileAuthBinding'

export type UploadSessionPurpose =
  | 'workspace_file'
  | 'project_file'
  | 'table_import'
  | 'knowledge_document'
  | 'profile_picture'
  | 'workspace_logo'
  | 'organization_logo'
  | 'mothership_attachment'
  | 'execution_attachment'

export type UploadStorageProvider = 'local' | 's3' | 'blob' | 'gcs'

export type UploadTransferMethod = 'put' | 'multipart'

export type UploadSessionStatus =
  | 'uploading'
  | 'completing'
  | 'finalizing'
  | 'completed'
  | 'aborting'
  | 'aborted'
  | 'failed'
  | 'expired'
