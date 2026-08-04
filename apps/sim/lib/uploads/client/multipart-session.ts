import { sleep } from '@sim/utils/helpers'
import type { V2CompletedPart, V2UploadPartUrl } from '@/lib/api/contracts/v2/uploads'
import {
  MULTIPART_MAX_RETRIES,
  MULTIPART_PART_CONCURRENCY,
  MULTIPART_RETRY_BACKOFF,
  MULTIPART_RETRY_DELAY_MS,
  runWithConcurrency,
  type UploadProgressEvent,
} from '@/lib/uploads/client/direct-upload'
import { isAbortError } from '@/lib/uploads/utils/file-utils'

interface UploadMultipartSessionParams<T> {
  file: File
  partSize: number
  partCount: number
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
  getPartUrls: (partNumbers: number[]) => Promise<V2UploadPartUrl[]>
  complete: (parts: V2CompletedPart[]) => Promise<T>
  abort: () => Promise<void>
}

export async function uploadMultipartSession<T>(
  params: UploadMultipartSessionParams<T>
): Promise<T> {
  const { file, partSize, partCount, signal, onProgress } = params
  const completedBytes = new Array<number>(partCount).fill(0)
  const completedParts: V2CompletedPart[] = []
  try {
    for (let start = 1; start <= partCount; start += 25) {
      const partNumbers = Array.from(
        { length: Math.min(25, partCount - start + 1) },
        (_, index) => start + index
      )
      const partUrls = await params.getPartUrls(partNumbers)
      const results = await runWithConcurrency(
        partUrls,
        MULTIPART_PART_CONCURRENCY,
        async (part): Promise<V2CompletedPart> => {
          const partStart = (part.partNumber - 1) * partSize
          const end = Math.min(partStart + partSize, file.size)
          const chunk = file.slice(partStart, end)
          for (let attempt = 0; attempt <= MULTIPART_MAX_RETRIES; attempt++) {
            try {
              // boundary-raw-fetch: signed multipart data-plane URL may target cloud storage or local Sim
              const response = await fetch(part.url, {
                method: 'PUT',
                body: chunk,
                headers: part.headers,
                signal,
              })
              if (!response.ok) {
                throw new Error(`Part ${part.partNumber} failed (${response.status})`)
              }
              completedBytes[part.partNumber - 1] = end - partStart
              const loaded = completedBytes.reduce((sum, bytes) => sum + bytes, 0)
              onProgress?.({
                loaded,
                total: file.size,
                percent: Math.min(100, Math.round((loaded / file.size) * 100)),
              })
              const etag = response.headers.get('etag')
              return {
                partNumber: part.partNumber,
                ...(etag ? { etag: etag.replaceAll('"', '') } : {}),
              }
            } catch (error) {
              if (isAbortError(error) || attempt >= MULTIPART_MAX_RETRIES) throw error
              await sleep(MULTIPART_RETRY_DELAY_MS * MULTIPART_RETRY_BACKOFF ** attempt)
            }
          }
          throw new Error(`Retries exhausted for part ${part.partNumber}`)
        }
      )
      completedParts.push(
        ...results.map((result) => {
          if (result.status === 'rejected') throw result.reason
          return result.value
        })
      )
    }
    return await params.complete(completedParts)
  } catch (error) {
    await params.abort().catch(() => {})
    throw error
  }
}
