import { requestJson } from '@/lib/api/client/request'
import {
  abortWorkspaceFileUploadContract,
  completeWorkspaceFileUploadContract,
  createWorkspaceFileUploadContract,
  createWorkspaceFileUploadPartUrlsContract,
} from '@/lib/api/contracts/upload-sessions'
import {
  type V2KnowledgeDocumentSummary,
  v2AbortKnowledgeDocumentUploadContract,
  v2CompleteKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadPartUrlsContract,
} from '@/lib/api/contracts/v2/knowledge'
import type { UploadProgressEvent } from '@/lib/uploads/client/direct-upload'
import { uploadMultipartSession } from '@/lib/uploads/client/multipart-session'
import { getFileContentType } from '@/lib/uploads/utils/file-utils'

interface UploadWorkspaceFileSessionParams {
  workspaceId: string
  folderId?: string | null
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

interface UploadKnowledgeDocumentSessionParams {
  workspaceId: string
  knowledgeBaseId: string
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

export async function uploadWorkspaceFileSession(params: UploadWorkspaceFileSessionParams) {
  const { workspaceId, folderId, file, signal, onProgress } = params
  const created = await requestJson(createWorkspaceFileUploadContract, {
    body: {
      workspaceId,
      name: file.name,
      contentType: getFileContentType(file),
      size: file.size,
      ...(folderId ? { folderId } : {}),
    },
    signal,
  })
  const upload = created.data
  return uploadMultipartSession({
    file,
    partSize: upload.partSize,
    partCount: upload.partCount,
    signal,
    onProgress,
    getPartUrls: async (partNumbers) => {
      const batch = await requestJson(createWorkspaceFileUploadPartUrlsContract, {
        params: { uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
        body: { partNumbers },
        signal,
      })
      return batch.data.parts
    },
    complete: async (parts) => {
      const completed = await requestJson(completeWorkspaceFileUploadContract, {
        params: { uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
        body: { parts },
        signal,
      })
      if (!completed.data.file) throw new Error('Completed upload returned no workspace file')
      return completed.data.file
    },
    abort: async () => {
      await requestJson(abortWorkspaceFileUploadContract, {
        params: { uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
      })
    },
  })
}

export async function uploadKnowledgeDocumentSession(
  params: UploadKnowledgeDocumentSessionParams
): Promise<V2KnowledgeDocumentSummary> {
  const { workspaceId, knowledgeBaseId, file, signal, onProgress } = params
  const created = await requestJson(v2CreateKnowledgeDocumentUploadContract, {
    params: { id: knowledgeBaseId },
    body: {
      workspaceId,
      name: file.name,
      contentType: getFileContentType(file),
      size: file.size,
    },
    signal,
  })
  const upload = created.data
  return uploadMultipartSession({
    file,
    partSize: upload.partSize,
    partCount: upload.partCount,
    signal,
    onProgress,
    getPartUrls: async (partNumbers) => {
      const batch = await requestJson(v2CreateKnowledgeDocumentUploadPartUrlsContract, {
        params: { id: knowledgeBaseId, uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
        body: { partNumbers },
        signal,
      })
      return batch.data.parts
    },
    complete: async (parts) => {
      const completed = await requestJson(v2CompleteKnowledgeDocumentUploadContract, {
        params: { id: knowledgeBaseId, uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
        body: { parts },
        signal,
      })
      if (!completed.data.document) {
        throw new Error('Completed upload returned no knowledge document')
      }
      return completed.data.document
    },
    abort: async () => {
      await requestJson(v2AbortKnowledgeDocumentUploadContract, {
        params: { id: knowledgeBaseId, uploadId: upload.id },
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
      })
    },
  })
}
