export const FILE_PREVIEW_SESSION_SCHEMA_VERSION = 1 as const

export type FilePreviewTargetKind = 'new_file' | 'file_id'
export type FilePreviewStatus = 'pending' | 'streaming' | 'complete'
export type FilePreviewContentMode = 'delta' | 'snapshot'

export interface FilePreviewSession {
  schemaVersion: typeof FILE_PREVIEW_SESSION_SCHEMA_VERSION
  id: string
  streamId: string
  toolCallId: string
  status: FilePreviewStatus
  fileName: string
  fileId?: string
  targetKind?: FilePreviewTargetKind
  operation?: string
  edit?: Record<string, unknown>
  baseContent?: string
  previewText: string
  previewVersion: number
  updatedAt: string
  completedAt?: string
}

export function isFilePreviewSession(value: unknown): value is FilePreviewSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === FILE_PREVIEW_SESSION_SCHEMA_VERSION &&
    typeof record.id === 'string' &&
    typeof record.streamId === 'string' &&
    typeof record.toolCallId === 'string' &&
    typeof record.status === 'string' &&
    typeof record.fileName === 'string' &&
    (record.baseContent === undefined || typeof record.baseContent === 'string') &&
    typeof record.previewText === 'string' &&
    typeof record.previewVersion === 'number' &&
    typeof record.updatedAt === 'string'
  )
}

export function sortFilePreviewSessions(sessions: FilePreviewSession[]): FilePreviewSession[] {
  return [...sessions].sort((a, b) => {
    const updatedAtCompare = a.updatedAt.localeCompare(b.updatedAt)
    if (updatedAtCompare !== 0) {
      return updatedAtCompare
    }
    return a.id.localeCompare(b.id)
  })
}
