import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFilesWithinBudget } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('MailAttachmentMaterialization')

export interface MailAttachmentContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

export interface MaterializedMailAttachment {
  buffer: Buffer
  contentType: string
  name: string
}

export type MailAttachmentFailureKind = 'access' | 'download' | 'not-ready' | 'size'

export class MailAttachmentMaterializationError extends Error {
  constructor(
    message: string,
    readonly kind: MailAttachmentFailureKind,
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly observedBytes?: number
  ) {
    super(message)
    this.name = 'MailAttachmentMaterializationError'
  }
}

interface MaterializeMailAttachmentsOptions {
  label: string
  maxTotalBytes: number
  preflightDeclaredSize?: boolean
}

function sizeFailure(label: string, observedBytes: number): MailAttachmentMaterializationError {
  return new MailAttachmentMaterializationError(
    `${label} exceeds its configured limit`,
    'size',
    400,
    { success: false, error: `${label} exceeds its configured limit` },
    observedBytes
  )
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

export async function materializeAuthorizedMailAttachments(
  rawAttachments: readonly RawFileInput[],
  context: MailAttachmentContext,
  options: MaterializeMailAttachmentsOptions
): Promise<MaterializedMailAttachment[]> {
  context.signal?.throwIfAborted()
  const files = processFilesToUserFiles([...rawAttachments], context.requestId, logger)
  if (files.length === 0) return []
  const declaredBytes = files.reduce((total, file) => total + file.size, 0)
  if (options.preflightDeclaredSize && declaredBytes > options.maxTotalBytes) {
    throw sizeFailure(options.label, declaredBytes)
  }

  for (const file of files) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) {
      throw new MailAttachmentMaterializationError(
        'File not found',
        'access',
        denied.status,
        await responseBody(denied)
      )
    }
  }

  let resolved: Awaited<ReturnType<typeof downloadServableFilesWithinBudget>>
  try {
    resolved = await downloadServableFilesWithinBudget(files, context.requestId, logger, {
      totalMaxBytes: options.maxTotalBytes,
      label: options.label,
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      const message = docNotReadyMessage()
      throw new MailAttachmentMaterializationError(message, 'not-ready', 409, {
        success: false,
        error: message,
      })
    }
    if (isPayloadSizeLimitError(error)) {
      throw sizeFailure(options.label, error.observedBytes ?? declaredBytes)
    }
    const message = `Failed to download attachment: ${getErrorMessage(error, 'Unknown error')}`
    throw new MailAttachmentMaterializationError(message, 'download', 500, {
      success: false,
      error: message,
    })
  }
  context.signal?.throwIfAborted()

  return files.map((file, index) => {
    const materialized = resolved[index]
    if (!materialized) {
      const message = 'Failed to download attachment: Missing file data'
      throw new MailAttachmentMaterializationError(message, 'download', 500, {
        success: false,
        error: message,
      })
    }
    return {
      buffer: materialized.buffer,
      contentType: materialized.contentType || file.type || 'application/octet-stream',
      name: file.name,
    }
  })
}
