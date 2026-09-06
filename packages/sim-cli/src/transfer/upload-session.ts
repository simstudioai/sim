import { openAsBlob } from 'node:fs'
import { type EmbeddedFileSnapshot, embeddedProfile, embedStore } from '../embed-context'
import { SimApiError, SimClient } from '../http/client'
import { embeddedFileKey } from './local-file'
import { StreamingUpload } from './streaming-upload'

interface UploadPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
}

export type UploadTransfer =
  | {
      method: 'put'
      url: string
      headers: Record<string, string>
    }
  | {
      method: 'multipart'
      partSize: number
      partCount: number
    }

export interface UploadSession {
  basePath: string
  uploadToken: string
  transfer: UploadTransfer
  size: number
}

const PART_URL_BATCH = 100

async function uploadBytes(
  url: string,
  headers: Record<string, string>,
  file: Blob | StreamingUpload,
  start: number,
  end: number,
  label: string
): Promise<void> {
  const body = file.slice(start, end)
  const options: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    headers,
    body,
    signal: file instanceof StreamingUpload ? file.signal : embedStore.getStore()?.identity.signal,
  }
  if (file instanceof StreamingUpload) {
    const streamedHeaders = new Headers(headers)
    streamedHeaders.set('content-length', String(end - start))
    options.headers = streamedHeaders
    options.duplex = 'half'
  }
  // boundary-raw-fetch: signed upload data-plane URL may target cloud storage or local Sim
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new SimApiError(`${label} failed with status ${response.status}`, response.status)
  }
  if (file instanceof StreamingUpload) file.assertConsumed(end)
}

async function uploadParts(
  client: SimClient,
  workspaceId: string,
  session: UploadSession,
  transfer: Extract<UploadTransfer, { method: 'multipart' }>,
  file: Blob | StreamingUpload
): Promise<void> {
  if (
    file instanceof StreamingUpload &&
    (!Number.isSafeInteger(transfer.partSize) || transfer.partSize <= 0)
  ) {
    throw new SimApiError('Invalid upload part size', 0)
  }
  const expectedPartCount = Math.ceil(session.size / transfer.partSize)
  if (expectedPartCount !== transfer.partCount) {
    throw new Error(
      `Upload session expected ${transfer.partCount} parts, but file requires ${expectedPartCount}`
    )
  }

  for (let first = 1; first <= transfer.partCount; first += PART_URL_BATCH) {
    const partNumbers = []
    for (let n = first; n < first + PART_URL_BATCH && n <= transfer.partCount; n++) {
      partNumbers.push(n)
    }

    const signed = await client.request<{ data: { parts: UploadPartUrl[] } }>(
      `${session.basePath}/parts`,
      {
        method: 'POST',
        query: { workspaceId },
        headers: { 'upload-token': session.uploadToken },
        body: { partNumbers },
      }
    )

    let parts = signed.data.parts
    if (file instanceof StreamingUpload) {
      const numbers = new Set(parts.map((part) => part.partNumber))
      if (parts.length !== partNumbers.length || partNumbers.some((n) => !numbers.has(n))) {
        throw new SimApiError('Upload part URLs do not match the requested parts', 0)
      }
      parts = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    }
    for (const part of parts) {
      const start = (part.partNumber - 1) * transfer.partSize
      await uploadBytes(
        part.url,
        part.headers,
        file,
        start,
        Math.min(start + transfer.partSize, session.size),
        `Part ${part.partNumber}`
      )
    }
  }
}

/** Uploads and completes a signed transfer, aborting its session if the transfer fails. */
export async function finishUploadSession<T>(
  client: SimClient,
  workspaceId: string,
  session: UploadSession,
  path: string
): Promise<T> {
  let snapshot: EmbeddedFileSnapshot | undefined
  let streamed: StreamingUpload | undefined
  try {
    const embedded = embedStore.getStore()
    let file: Blob | StreamingUpload
    if (embedded) {
      embedded.identity.signal?.throwIfAborted()
      if (!embedded.openFile)
        throw new SimApiError('This invocation has no machine to read from', 0)
      snapshot = await embedded.openFile(embeddedFileKey(path))
      if (snapshot.size !== session.size) throw new SimApiError('Upload snapshot size changed', 0)
      streamed = new StreamingUpload(
        await snapshot.stream(),
        snapshot.size,
        embedded.identity.signal
      )
      file = streamed
    } else {
      file = await openAsBlob(path)
    }
    if (session.transfer.method === 'put') {
      await uploadBytes(
        session.transfer.url,
        session.transfer.headers,
        file,
        0,
        file instanceof Blob ? file.size : session.size,
        'Upload'
      )
    } else {
      await uploadParts(client, workspaceId, session, session.transfer, file)
    }
    await streamed?.verifyComplete()

    const completed = await client.request<{ data: T }>(`${session.basePath}/complete`, {
      method: 'POST',
      query: { workspaceId },
      headers: { 'upload-token': session.uploadToken },
    })
    return completed.data
  } catch (error) {
    await streamed?.close()
    /** Stop cancels transfer work, but cleanup needs its own short-lived request signal. */
    const profile = embeddedProfile()
    const cleanupClient = profile
      ? new SimClient({ ...profile, signal: AbortSignal.timeout(5_000) })
      : client
    await cleanupClient
      .request(session.basePath, {
        method: 'DELETE',
        query: { workspaceId },
        headers: { 'upload-token': session.uploadToken },
      })
      .catch(() => undefined)
    throw error
  } finally {
    await streamed?.close()
    await snapshot?.dispose().catch(() => {})
  }
}
