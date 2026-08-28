import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { BREX_API_BASE, buildBrexHeaders } from '@/tools/brex/utils'

interface BrexReceiptUploadTarget {
  id?: string
  uri?: string
}

export class BrexReceiptError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'BrexReceiptError'
  }
}

function parseBrexError(errorText: string): string {
  try {
    const parsed: unknown = JSON.parse(errorText)
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  } catch {}
  return errorText
}

export class BrexReceiptClient {
  constructor(
    private readonly apiKey: string,
    private readonly signal?: AbortSignal
  ) {}

  async createUploadTarget(
    receiptName: string,
    expenseId?: string
  ): Promise<BrexReceiptUploadTarget> {
    this.signal?.throwIfAborted()
    const endpoint = expenseId
      ? `${BREX_API_BASE}/v1/expenses/card/${encodeURIComponent(expenseId)}/receipt_upload`
      : `${BREX_API_BASE}/v1/expenses/card/receipt_match`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildBrexHeaders(this.apiKey),
      body: JSON.stringify({ receipt_name: receiptName }),
      signal: this.signal,
    })
    const body = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Brex receipt upload target response',
      signal: this.signal,
    })
    if (!response.ok) {
      throw new BrexReceiptError(
        `Brex API error (${response.status}): ${parseBrexError(body)}`,
        response.status
      )
    }
    return JSON.parse(body) as BrexReceiptUploadTarget
  }

  async uploadReceipt(uri: string, buffer: Buffer): Promise<void> {
    this.signal?.throwIfAborted()
    const validation = await validateUrlWithDNS(uri, 'uri')
    this.signal?.throwIfAborted()
    if (!validation.isValid || !validation.resolvedIP) {
      throw new BrexReceiptError('Brex returned an invalid upload URL', 502)
    }
    const response = await secureFetchWithPinnedIP(uri, validation.resolvedIP, {
      method: 'PUT',
      headers: { 'Content-Length': String(buffer.byteLength) },
      body: new Uint8Array(buffer),
      maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      signal: this.signal,
    })
    if (response.body) {
      await readStreamToBufferWithLimit(response.body, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Brex pre-signed upload response',
        signal: this.signal,
      })
    }
    this.signal?.throwIfAborted()
    if (!response.ok) {
      throw new BrexReceiptError(`Failed to upload receipt file (${response.status})`, 502)
    }
  }
}
