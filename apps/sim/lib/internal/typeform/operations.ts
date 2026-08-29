import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { TypeformOperationError } from '@/lib/internal/typeform/errors'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { TypeformFilesParams, TypeformFilesResponse } from '@/tools/typeform/types'

const MAX_TYPEFORM_FILE_BYTES = 10 * 1024 * 1024

export interface TypeformOperationContext {
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
}

function buildTypeformFileUrl(input: TypeformFilesParams): string {
  const url = new URL(
    `https://api.typeform.com/forms/${encodeURIComponent(input.formId)}/responses/${encodeURIComponent(input.responseId)}/fields/${encodeURIComponent(input.fieldId)}/files/${encodeURIComponent(input.filename)}`
  )
  if (input.inline !== undefined) url.searchParams.set('inline', String(input.inline))
  return url.toString()
}

function getFilename(
  response: { headers: { get(name: string): string | null } },
  fallback: string
): string {
  const disposition = response.headers.get('content-disposition') || ''
  return disposition.match(/filename="(.+?)"/)?.[1] || fallback || 'typeform-file'
}

export async function downloadTypeformFile(
  input: TypeformFilesParams,
  context: TypeformOperationContext
): Promise<TypeformFilesResponse> {
  context.signal?.throwIfAborted()
  const fileUrl = buildTypeformFileUrl(input)
  const validation = await validateUrlWithDNS(fileUrl, 'typeformFileUrl', 'configuredEndpoint')
  context.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new TypeformOperationError(validation.error || 'Invalid Typeform file URL', 400)
  }
  const response = await secureFetchWithPinnedIP(fileUrl, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    headers: { Authorization: `Bearer ${input.apiKey}` },
    maxResponseBytes: MAX_TYPEFORM_FILE_BYTES,
    signal: context.signal,
  })
  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Typeform file error response',
      signal: context.signal,
    }).catch(() => '')
    throw new TypeformOperationError(
      `Failed to download Typeform file: ${response.status} ${errorText}`,
      response.status
    )
  }
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_TYPEFORM_FILE_BYTES,
    label: 'Typeform file download',
    signal: context.signal,
  })
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const filename = getFilename(response, input.filename)
  context.signal?.throwIfAborted()

  if (context.workspaceId && context.workflowId && context.executionId) {
    const file = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      buffer,
      filename,
      contentType,
      context.userId
    )
    context.signal?.throwIfAborted()
    return {
      success: true,
      output: {
        fileUrl: file.url,
        file: { ...file, mimeType: contentType },
        contentType,
        filename,
      },
    }
  }

  const file = await uploadCopilotFile({
    buffer,
    fileName: filename,
    contentType,
    userId: context.userId,
  })
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: { fileUrl: file.url || fileUrl, file, contentType, filename },
  }
}
