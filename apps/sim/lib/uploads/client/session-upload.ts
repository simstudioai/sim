import { requestJson } from '@/lib/api/client/request'
import {
  abortKnowledgeDocumentUploadContract,
  completeKnowledgeDocumentUploadContract,
  createKnowledgeDocumentUploadContract,
  createKnowledgeDocumentUploadPartUrlsContract,
  type KnowledgeDocumentUploadMetadataBody,
  type KnowledgeDocumentUploadPartUrl,
  type KnowledgeDocumentUploadSummary,
  type KnowledgeDocumentUploadTransfer,
} from '@/lib/api/contracts/knowledge/upload-sessions'
import {
  abortInternalFileUploadContract,
  type CreateInternalFileUploadBody,
  completeInternalFileUploadContract,
  createInternalFileUploadContract,
  createInternalFileUploadPartUrlsContract,
  type InternalFileUploadSession,
} from '@/lib/api/contracts/upload-sessions'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import { uploadFileSession } from '@/lib/uploads/client/upload-session'
import { getFileContentType } from '@/lib/uploads/utils/file-utils'

interface UploadWorkspaceFileSessionParams {
  workspaceId: string
  folderId?: string | null
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

interface InternalUploadCommonParams {
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

type InternalUploadContext =
  | { purpose: 'workspace_file'; workspaceId: string; folderId?: string | null }
  | { purpose: 'profile_picture' }
  | { purpose: 'workspace_logo'; workspaceId: string }
  | { purpose: 'mothership_attachment'; workspaceId: string }
  | {
      purpose: 'execution_attachment'
      workspaceId: string
      workflowId: string
      executionId: string
    }

type InternalUploadPurpose = InternalUploadContext['purpose']
type InternalUploadResult<Purpose extends InternalUploadPurpose> = NonNullable<
  Extract<InternalFileUploadSession, { purpose: Purpose }>['result']
>

export type UploadInternalFileSessionParams = InternalUploadCommonParams & InternalUploadContext

interface UploadKnowledgeDocumentSessionParams extends KnowledgeDocumentUploadMetadataBody {
  workspaceId: string
  knowledgeBaseId: string
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

interface RunCreatedUploadParams<T> {
  file: File
  transfer: KnowledgeDocumentUploadTransfer
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
  getPartUrls: (partNumbers: number[]) => Promise<KnowledgeDocumentUploadPartUrl[]>
  complete: () => Promise<T>
  abort: () => Promise<void>
}

function runCreatedUpload<T>(params: RunCreatedUploadParams<T>): Promise<T> {
  const common = {
    file: params.file,
    signal: params.signal,
    onProgress: params.onProgress,
    complete: params.complete,
    abort: params.abort,
  }
  return params.transfer.method === 'put'
    ? uploadFileSession({ ...common, transfer: params.transfer })
    : uploadFileSession({
        ...common,
        transfer: params.transfer,
        getPartUrls: params.getPartUrls,
      })
}

export async function uploadWorkspaceFileSession(params: UploadWorkspaceFileSessionParams) {
  return uploadInternalFileSession({
    purpose: 'workspace_file',
    ...params,
  })
}

export async function uploadInternalFileSession<Purpose extends InternalUploadPurpose>(
  params: InternalUploadCommonParams & Extract<InternalUploadContext, { purpose: Purpose }>
): Promise<InternalUploadResult<Purpose>> {
  const { file, signal, onProgress } = params
  const created = await requestJson(createInternalFileUploadContract, {
    body: internalUploadBody(params),
    signal,
  })
  const { session, uploadToken, transfer } = created.data
  if (session.purpose !== params.purpose) {
    throw new Error(`Expected ${params.purpose} upload session; received ${session.purpose}`)
  }
  return runCreatedUpload({
    file,
    transfer,
    signal,
    onProgress,
    getPartUrls: async (partNumbers) => {
      const batch = await requestJson(createInternalFileUploadPartUrlsContract, {
        params: { uploadId: session.id },
        headers: { 'upload-token': uploadToken },
        body: { partNumbers },
        signal,
      })
      return batch.data.parts
    },
    complete: async () => {
      const completed = await requestJson(completeInternalFileUploadContract, {
        params: { uploadId: session.id },
        headers: { 'upload-token': uploadToken },
        signal,
      })
      if (completed.data.purpose !== params.purpose) {
        throw new Error(`Expected ${params.purpose} completion; received ${completed.data.purpose}`)
      }
      if (!completed.data.result) {
        throw new Error(`Completed ${params.purpose} upload returned no result`)
      }
      return completed.data.result as InternalUploadResult<Purpose>
    },
    abort: async () => {
      await requestJson(abortInternalFileUploadContract, {
        params: { uploadId: session.id },
        headers: { 'upload-token': uploadToken },
      })
    },
  })
}

function internalUploadBody(params: UploadInternalFileSessionParams): CreateInternalFileUploadBody {
  const fileFields = {
    name: params.file.name,
    contentType: getFileContentType(params.file),
    size: params.file.size,
  }
  switch (params.purpose) {
    case 'workspace_file':
      return {
        purpose: params.purpose,
        workspaceId: params.workspaceId,
        ...fileFields,
        ...(params.folderId ? { folderId: params.folderId } : {}),
      }
    case 'profile_picture':
      return { purpose: params.purpose, ...fileFields }
    case 'workspace_logo':
    case 'mothership_attachment':
      return {
        purpose: params.purpose,
        workspaceId: params.workspaceId,
        ...fileFields,
      }
    case 'execution_attachment':
      return {
        purpose: params.purpose,
        workspaceId: params.workspaceId,
        workflowId: params.workflowId,
        executionId: params.executionId,
        ...fileFields,
      }
  }
}

export async function uploadKnowledgeDocumentSession(
  params: UploadKnowledgeDocumentSessionParams
): Promise<KnowledgeDocumentUploadSummary> {
  const { workspaceId, knowledgeBaseId, file, signal, onProgress, ...metadata } = params
  const created = await requestJson(createKnowledgeDocumentUploadContract, {
    params: { id: knowledgeBaseId },
    body: {
      workspaceId,
      name: file.name,
      contentType: getFileContentType(file),
      size: file.size,
      ...metadata,
    },
    signal,
  })
  const { session, uploadToken, transfer } = created.data
  return runCreatedUpload({
    file,
    transfer,
    signal,
    onProgress,
    getPartUrls: async (partNumbers) => {
      const batch = await requestJson(createKnowledgeDocumentUploadPartUrlsContract, {
        params: { id: knowledgeBaseId, uploadId: session.id },
        query: { workspaceId },
        headers: { 'upload-token': uploadToken },
        body: { partNumbers },
        signal,
      })
      return batch.data.parts
    },
    complete: async () => {
      const completed = await requestJson(completeKnowledgeDocumentUploadContract, {
        params: { id: knowledgeBaseId, uploadId: session.id },
        query: { workspaceId },
        headers: { 'upload-token': uploadToken },
        signal,
      })
      if (!completed.data.document) {
        throw new Error('Completed upload returned no knowledge document')
      }
      return completed.data.document
    },
    abort: async () => {
      await requestJson(abortKnowledgeDocumentUploadContract, {
        params: { id: knowledgeBaseId, uploadId: session.id },
        query: { workspaceId },
        headers: { 'upload-token': uploadToken },
      })
    },
  })
}
