import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GoogleVaultOperationError } from '@/lib/internal/google-vault/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { GoogleVaultDownloadExportFileParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'

export interface GoogleVaultOperationContext {
  signal?: AbortSignal
}

function resolveFilename(
  disposition: string,
  requestedName: string | undefined,
  objectName: string
): string {
  if (requestedName) return requestedName
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/)
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  if (match?.[2]) return match[2]
  return objectName.split('/').at(-1) || 'vault-export.bin'
}

export async function downloadGoogleVaultExportFile(
  input: GoogleVaultDownloadExportFileParams,
  context: GoogleVaultOperationContext
) {
  context.signal?.throwIfAborted()
  const bucket = encodeURIComponent(input.bucketName)
  const object = encodeURIComponent(input.objectName)
  const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`
  const validation = await validateUrlWithDNS(downloadUrl, 'downloadUrl')
  context.signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new GoogleVaultOperationError(
      enhanceGoogleVaultError(validation.error || 'Invalid URL'),
      400
    )
  }

  const response = await secureFetchWithPinnedIP(downloadUrl, validation.resolvedIP, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.accessToken}` },
    maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
    signal: context.signal,
  })
  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Google Vault export error response',
      signal: context.signal,
    }).catch(() => '')
    throw new GoogleVaultOperationError(
      enhanceGoogleVaultError(
        `Failed to download file: ${errorText || response.statusText || response.status}`
      ),
      400
    )
  }

  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    label: 'Google Vault export file',
    signal: context.signal,
  })
  context.signal?.throwIfAborted()
  const mimeType = response.headers.get('content-type') || 'application/octet-stream'
  const name = resolveFilename(
    response.headers.get('content-disposition') || '',
    input.fileName,
    input.objectName
  )
  return {
    success: true,
    output: {
      file: { name, mimeType, data: buffer.toString('base64'), size: buffer.length },
    },
  }
}
