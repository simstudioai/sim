export type UploadSessionPurpose =
  | 'workspace_file'
  | 'table_import'
  | 'knowledge_document'
  | 'profile_picture'
  | 'workspace_logo'
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
