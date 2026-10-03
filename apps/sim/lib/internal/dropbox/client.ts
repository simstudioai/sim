import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import { httpHeaderSafeJson } from '@/lib/core/utils/validation'

interface DropboxErrorBody {
  error_summary?: string
  error?: { message?: string }
}

export class DropboxUploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'DropboxUploadError'
  }
}

export class DropboxClient {
  constructor(
    private readonly accessToken: string,
    private readonly signal?: AbortSignal
  ) {}

  async upload(
    path: string,
    buffer: Buffer,
    options: {
      mode?: 'add' | 'overwrite' | null
      autorename?: boolean | null
      mute?: boolean | null
    }
  ): Promise<Record<string, unknown>> {
    this.signal?.throwIfAborted()
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': httpHeaderSafeJson({
          path,
          mode: options.mode || 'add',
          autorename: options.autorename ?? false,
          mute: options.mute ?? false,
        }),
      },
      body: new Uint8Array(buffer),
      signal: this.signal,
    })
    const data = await readResponseJsonWithLimit<Record<string, unknown> & DropboxErrorBody>(
      response,
      {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Dropbox file upload response',
        signal: this.signal,
      }
    )
    if (!response.ok) {
      throw new DropboxUploadError(
        data.error_summary || data.error?.message || 'Failed to upload file',
        response.status
      )
    }
    return data
  }
}
