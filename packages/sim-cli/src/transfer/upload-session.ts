import { openAsBlob } from 'node:fs'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import { type EmbeddedFileSnapshot, embedStore } from '#sim-cli/embed-context'
import {
  combineSignals,
  RAISE_TIMEOUT_HINT,
  resolveTimeoutMs,
  SimApiError,
  type SimClient,
} from '#sim-cli/http/client'
import { embeddedFileKey } from '#sim-cli/transfer/local-file'
import { retryTransfer } from '#sim-cli/transfer/retry'
import { StreamingUpload } from '#sim-cli/transfer/streaming-upload'

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
  /** GET basePath statuses confirming publication; null when the domain exposes no status endpoint. */
  completionStatuses: readonly string[] | null
  /** True only when replaying completion cannot race or duplicate domain finalization. */
  completionReplayable: boolean
}

const PART_URL_BATCH = 100
const PART_CONCURRENCY = 4

async function uploadBytes(
  url: string,
  headers: Record<string, string>,
  file: Blob | StreamingUpload,
  start: number,
  end: number,
  label: string,
  signal?: AbortSignal,
  createOnly = false
): Promise<void> {
  const timeoutMs = resolveTimeoutMs()
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  const caller = combineSignals(signal, file instanceof StreamingUpload ? file.signal : undefined)
  const requestSignal = combineSignals(caller, timeout)
  try {
    await retryTransfer(
      async (attempt) => {
        const options: RequestInit & { duplex?: 'half' } = {
          method: 'PUT',
          headers,
          body: file.slice(start, end),
          signal: requestSignal,
          redirect: 'manual',
        }
        if (file instanceof StreamingUpload) {
          const streamedHeaders = new Headers(headers)
          streamedHeaders.set('content-length', String(end - start))
          options.headers = streamedHeaders
          options.duplex = 'half'
        }
        let response: Response
        try {
          // boundary-raw-fetch: signed upload data-plane URL may target cloud storage or local Sim
          response = await fetch(url, options)
        } catch (error) {
          requestSignal?.throwIfAborted()
          throw new SimApiError(
            `${label} could not transfer its bytes: ${getErrorMessage(error)}`,
            0,
            'TRANSPORT_FAILED'
          )
        }
        await response.body?.cancel().catch(() => {})
        /** A lost PUT acknowledgement can leave the create-only object present; completion verifies its identity and size. */
        if (createOnly && attempt > 1 && (response.status === 409 || response.status === 412))
          return
        if (!response.ok) {
          const error = new SimApiError(
            `${label} failed with status ${response.status}`,
            response.status
          )
          error.retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after'),
            Number.MAX_SAFE_INTEGER
          )
          throw error
        }
        if (file instanceof StreamingUpload) file.assertConsumed(end)
      },
      { signal: requestSignal, replayable: file instanceof Blob }
    )
  } catch (error) {
    caller?.throwIfAborted()
    if (timeout?.aborted) {
      throw new SimApiError(
        `${label} did not finish within ${timeoutMs / 1000}s. ${RAISE_TIMEOUT_HINT}`,
        0,
        'REQUEST_TIMEOUT'
      )
    }
    throw error
  }
}

async function uploadParts(
  client: SimClient,
  workspaceId: string,
  session: UploadSession,
  transfer: Extract<UploadTransfer, { method: 'multipart' }>,
  file: Blob | StreamingUpload
): Promise<void> {
  if (
    !Number.isSafeInteger(transfer.partSize) ||
    transfer.partSize <= 0 ||
    !Number.isSafeInteger(transfer.partCount) ||
    transfer.partCount <= 0
  ) {
    throw new SimApiError('Invalid upload part size', 0)
  }
  const expectedPartCount = Math.ceil(session.size / transfer.partSize)
  if (expectedPartCount !== transfer.partCount) {
    throw new SimApiError(
      `Upload session expected ${transfer.partCount} parts, but file requires ${expectedPartCount}`,
      0
    )
  }

  for (let first = 1; first <= transfer.partCount; first += PART_URL_BATCH) {
    const partNumbers: number[] = []
    for (let n = first; n < first + PART_URL_BATCH && n <= transfer.partCount; n++) {
      partNumbers.push(n)
    }

    const caller = combineSignals(
      client.signal,
      file instanceof StreamingUpload ? file.signal : undefined
    )
    const signed = await retryTransfer(
      () =>
        client.request<{ data: { parts: UploadPartUrl[] } }>(`${session.basePath}/parts`, {
          method: 'POST',
          query: { workspaceId },
          headers: { 'upload-token': session.uploadToken },
          body: { partNumbers },
          signal: caller,
        }),
      { signal: caller }
    )

    const numbers = new Set(signed.data.parts.map((part) => part.partNumber))
    if (
      signed.data.parts.length !== partNumbers.length ||
      partNumbers.some((n) => !numbers.has(n))
    ) {
      throw new SimApiError('Upload part URLs do not match the requested parts', 0)
    }
    const parts = [...signed.data.parts].sort((a, b) => a.partNumber - b.partNumber)
    const stopped = new AbortController()
    const signal = combineSignals(caller, stopped.signal)
    let next = 0
    let failure: { error: unknown } | undefined
    const worker = async () => {
      try {
        while (next < parts.length && !signal?.aborted) {
          const part = parts[next++]
          const start = (part.partNumber - 1) * transfer.partSize
          await uploadBytes(
            part.url,
            part.headers,
            file,
            start,
            Math.min(start + transfer.partSize, session.size),
            `Part ${part.partNumber}`,
            signal
          )
        }
        caller?.throwIfAborted()
      } catch (error) {
        if (!failure) {
          failure = { error }
          stopped.abort(error)
        }
      }
    }
    /** Host snapshots are forward-only; only local blobs support parallel reads and replay. */
    const concurrency = file instanceof StreamingUpload ? 1 : PART_CONCURRENCY
    await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker))
    if (failure) throw failure.error
  }
}

/** Aborts failed byte transfers, but preserves sessions once domain completion may have started. */
export async function finishUploadSession<T>(
  client: SimClient,
  workspaceId: string,
  session: UploadSession,
  path: string
): Promise<T> {
  let snapshot: EmbeddedFileSnapshot | undefined
  let streamed: StreamingUpload | undefined
  let completionStarted = false
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
        AbortSignal.any([
          ...(embedded.identity.signal ? [embedded.identity.signal] : []),
          ...(snapshot.signal ? [snapshot.signal] : []),
        ])
      )
      file = streamed
    } else {
      file = await openAsBlob(path)
      if (file.size !== session.size) throw new SimApiError('Upload file size changed', 0)
    }
    if (session.transfer.method === 'put') {
      await uploadBytes(
        session.transfer.url,
        session.transfer.headers,
        file,
        0,
        file instanceof Blob ? file.size : session.size,
        'Upload',
        client.signal,
        true
      )
    } else {
      await uploadParts(client, workspaceId, session, session.transfer, file)
    }
    await streamed?.verifyComplete()
    await streamed?.close()
    await snapshot?.dispose().catch(() => {})
    snapshot = undefined

    client.signal?.throwIfAborted()
    completionStarted = true
    const completed = await retryTransfer(
      () =>
        client.request<{ data: T }>(`${session.basePath}/complete`, {
          method: 'POST',
          query: { workspaceId },
          headers: { 'upload-token': session.uploadToken },
        }),
      { signal: client.signal, replayable: session.completionReplayable }
    )
    return completed.data
  } catch (error) {
    await streamed?.close()
    /** Stop cancels transfer work, but reconciliation and cleanup need a separate short-lived signal. */
    const cleanupClient = client.withSignal(AbortSignal.timeout(5_000))
    if (completionStarted) {
      if (session.completionStatuses) {
        const current = await cleanupClient
          .request<{ data: T }>(session.basePath, {
            query: { workspaceId },
            headers: { 'upload-token': session.uploadToken },
          })
          .catch(() => undefined)
        if (
          current &&
          isRecordLike(current.data) &&
          typeof current.data.status === 'string' &&
          session.completionStatuses.includes(current.data.status)
        ) {
          return current.data
        }
      }
      const recovery = session.completionStatuses
        ? 'check its status before starting another upload'
        : 'check the destination for the uploaded resource before starting another upload'
      throw new SimApiError(
        `Upload completion could not be confirmed (${session.basePath}). The session was preserved; ${recovery}. ${getErrorMessage(error)}`,
        error instanceof SimApiError ? error.status : 0,
        'UPLOAD_COMPLETION_UNCONFIRMED'
      )
    }
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
