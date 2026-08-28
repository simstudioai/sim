import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'

interface BoxUploadEntry {
  id?: string
  name?: string
  size?: number
  sha1?: string | null
  created_at?: string | null
  modified_at?: string | null
  parent?: { id?: string; name?: string }
}

interface BoxUploadResponseBody {
  entries?: BoxUploadEntry[]
  message?: string
}

export class BoxUploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'BoxUploadError'
  }
}

export class BoxClient {
  constructor(
    private readonly accessToken: string,
    private readonly signal?: AbortSignal
  ) {}

  async upload(parentFolderId: string, fileName: string, buffer: Buffer) {
    this.signal?.throwIfAborted()
    const formData = new FormData()
    formData.append(
      'attributes',
      JSON.stringify({ name: fileName, parent: { id: parentFolderId } })
    )
    formData.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }),
      fileName
    )
    const response = await fetch('https://upload.box.com/api/2.0/files/content', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: formData,
      signal: this.signal,
    })
    const data = await readResponseJsonWithLimit<BoxUploadResponseBody>(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Box file upload response',
      signal: this.signal,
    })
    if (!response.ok) {
      throw new BoxUploadError(data.message || 'Failed to upload file', response.status)
    }
    const file = data.entries?.[0]
    if (!file) throw new BoxUploadError('No file returned in upload response', 500)
    return {
      id: file.id ?? '',
      name: file.name ?? '',
      size: file.size ?? 0,
      sha1: file.sha1 ?? null,
      createdAt: file.created_at ?? null,
      modifiedAt: file.modified_at ?? null,
      parentId: file.parent?.id ?? null,
      parentName: file.parent?.name ?? null,
    }
  }
}
