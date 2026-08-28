import {
  type SecureFetchOptions,
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  secureFetchWithValidation,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

interface GraphErrorBody {
  error?: { message?: string }
}

export interface SharePointDriveItemMetadata {
  id?: string
  name?: string
  folder?: Record<string, unknown>
  file?: { mimeType?: string }
}

export interface SharePointUploadedItem {
  id: string
  name: string
  webUrl: string
  size: number
  createdDateTime?: string
  lastModifiedDateTime?: string
}

export interface SharePointUploadResult {
  ok: boolean
  status: number
  data: SharePointUploadedItem | GraphErrorBody
}

export class SharePointGraphError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'SharePointGraphError'
  }
}

async function readJsonOrEmpty<T>(
  response: SecureFetchResponse,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  try {
    return await readResponseJsonWithLimit<T>(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label,
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    return {} as T
  }
}

function readJson<T>(
  response: SecureFetchResponse,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label,
    signal,
  })
}

function graphErrorMessage(
  data: SharePointUploadedItem | GraphErrorBody,
  fallback: string
): string {
  return 'error' in data && data.error?.message ? data.error.message : fallback
}

export class SharePointClient {
  constructor(
    private readonly accessToken: string,
    private readonly signal?: AbortSignal
  ) {}

  private get authorization(): string {
    return `Bearer ${this.accessToken}`
  }

  /** Every URL reaching here is a fixed Microsoft Graph endpoint. */
  private async pinnedFetch(
    url: string,
    paramName: string,
    options: Omit<SecureFetchOptions, 'profile'>
  ): Promise<SecureFetchResponse> {
    this.signal?.throwIfAborted()
    const validation = await validateUrlWithDNS(url, paramName, 'configuredEndpoint')
    this.signal?.throwIfAborted()
    if (!validation.isValid || !validation.resolvedIP) {
      throw new SharePointGraphError(validation.error || `Invalid ${paramName}`, 400)
    }
    return secureFetchWithPinnedIP(url, validation.resolvedIP, {
      ...options,
      profile: 'configuredEndpoint',
      signal: this.signal,
    })
  }

  async getMetadata(driveId: string, itemId: string): Promise<SharePointDriveItemMetadata> {
    const url = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`
    const response = await this.pinnedFetch(url, 'metadataUrl', {
      headers: { Authorization: this.authorization },
    })
    if (!response.ok) {
      const data = await readJsonOrEmpty<GraphErrorBody>(
        response,
        'SharePoint metadata error response',
        this.signal
      )
      throw new SharePointGraphError(data.error?.message || 'Failed to get file metadata', 400)
    }
    return readJson<SharePointDriveItemMetadata>(
      response,
      'SharePoint metadata response',
      this.signal
    )
  }

  async download(driveId: string, itemId: string): Promise<Buffer> {
    const url = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`
    const response = await this.pinnedFetch(url, 'downloadUrl', {
      headers: { Authorization: this.authorization },
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_FILE_SIZE,
    })
    if (!response.ok) {
      const data = await readJsonOrEmpty<GraphErrorBody>(
        response,
        'SharePoint download error response',
        this.signal
      )
      throw new SharePointGraphError(data.error?.message || 'Failed to download file', 400)
    }
    return readResponseToBufferWithLimit(response, {
      maxBytes: MAX_FILE_SIZE,
      label: 'SharePoint file download',
      signal: this.signal,
    })
  }

  async upload(
    url: string,
    buffer: Buffer,
    contentType: string,
    label = 'uploadUrl'
  ): Promise<SharePointUploadResult> {
    this.signal?.throwIfAborted()
    const response = await secureFetchWithValidation(
      url,
      {
        profile: 'contentFetch',
        method: 'PUT',
        headers: {
          Authorization: this.authorization,
          'Content-Type': contentType,
        },
        body: buffer,
        signal: this.signal,
      },
      label
    )
    const data = response.ok
      ? await readJson<SharePointUploadedItem>(
          response,
          `SharePoint ${label} response`,
          this.signal
        )
      : await readJsonOrEmpty<GraphErrorBody>(
          response,
          `SharePoint ${label} error response`,
          this.signal
        )
    return { ok: response.ok, status: response.status, data }
  }

  static errorMessage(result: SharePointUploadResult, fallback: string): string {
    return graphErrorMessage(result.data, fallback)
  }
}
