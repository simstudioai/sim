import { openAsBlob } from 'node:fs'
import { SimApiError, type SimClient } from '../http/client.js'

interface UploadPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
}

export interface Transfer {
  basePath: string
  uploadToken: string
  partSize: number
  partCount: number
  size: number
}

const PART_URL_BATCH = 100

async function uploadParts(
  client: SimClient,
  workspaceId: string,
  transfer: Transfer,
  blob: Blob
): Promise<Array<{ partNumber: number; etag?: string }>> {
  const completed: Array<{ partNumber: number; etag?: string }> = []

  for (let first = 1; first <= transfer.partCount; first += PART_URL_BATCH) {
    const partNumbers = []
    for (let n = first; n < first + PART_URL_BATCH && n <= transfer.partCount; n++) {
      partNumbers.push(n)
    }

    const signed = await client.request<{ data: { parts: UploadPartUrl[] } }>(
      `${transfer.basePath}/parts`,
      {
        method: 'POST',
        query: { workspaceId },
        headers: { 'upload-token': transfer.uploadToken },
        body: { partNumbers },
      }
    )

    for (const part of signed.data.parts) {
      const start = (part.partNumber - 1) * transfer.partSize
      const chunk = blob.slice(start, Math.min(start + transfer.partSize, transfer.size))

      // boundary-raw-fetch: storage-signed URL on another origin, not the API
      const response = await fetch(part.url, {
        method: 'PUT',
        headers: part.headers,
        body: chunk,
      })
      if (!response.ok) {
        throw new SimApiError(
          `Part ${part.partNumber} failed with status ${response.status}`,
          response.status
        )
      }

      const etag = response.headers.get('etag')?.replace(/"/g, '')
      completed.push(etag ? { partNumber: part.partNumber, etag } : { partNumber: part.partNumber })
    }
  }

  return completed
}

/** Uploads and completes a multipart transfer, aborting it if either step fails. */
export async function finishTransfer<T>(
  client: SimClient,
  workspaceId: string,
  transfer: Transfer,
  path: string
): Promise<T> {
  try {
    const blob = await openAsBlob(path)
    const parts = await uploadParts(client, workspaceId, transfer, blob)
    const completed = await client.request<{ data: T }>(`${transfer.basePath}/complete`, {
      method: 'POST',
      query: { workspaceId },
      headers: { 'upload-token': transfer.uploadToken },
      body: { parts },
    })
    return completed.data
  } catch (error) {
    await client
      .request(transfer.basePath, {
        method: 'DELETE',
        query: { workspaceId },
        headers: { 'upload-token': transfer.uploadToken },
      })
      .catch(() => undefined)
    throw error
  }
}
