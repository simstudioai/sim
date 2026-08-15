import { openAsBlob } from 'node:fs'
import { SimApiError, type SimClient } from '../http/client'

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

async function uploadPut(transfer: Extract<UploadTransfer, { method: 'put' }>, blob: Blob) {
  // boundary-raw-fetch: signed upload data-plane URL may target cloud storage or local Sim
  const response = await fetch(transfer.url, {
    method: 'PUT',
    headers: transfer.headers,
    body: blob,
  })
  if (!response.ok) {
    throw new SimApiError(`Upload failed with status ${response.status}`, response.status)
  }
}

async function uploadParts(
  client: SimClient,
  workspaceId: string,
  session: UploadSession,
  transfer: Extract<UploadTransfer, { method: 'multipart' }>,
  blob: Blob
): Promise<void> {
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

    for (const part of signed.data.parts) {
      const start = (part.partNumber - 1) * transfer.partSize
      const chunk = blob.slice(start, Math.min(start + transfer.partSize, session.size))

      // boundary-raw-fetch: signed upload data-plane URL may target cloud storage or local Sim
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
  try {
    const blob = await openAsBlob(path)
    if (session.transfer.method === 'put') {
      await uploadPut(session.transfer, blob)
    } else {
      await uploadParts(client, workspaceId, session, session.transfer, blob)
    }

    const completed = await client.request<{ data: T }>(`${session.basePath}/complete`, {
      method: 'POST',
      query: { workspaceId },
      headers: { 'upload-token': session.uploadToken },
    })
    return completed.data
  } catch (error) {
    await client
      .request(session.basePath, {
        method: 'DELETE',
        query: { workspaceId },
        headers: { 'upload-token': session.uploadToken },
      })
      .catch(() => undefined)
    throw error
  }
}
