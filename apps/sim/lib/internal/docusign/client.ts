import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'

const MAX_DOCUSIGN_JSON_BYTES = 2 * 1024 * 1024
export const MAX_DOCUSIGN_DOCUMENT_BYTES = 25 * 1024 * 1024
const DOCUSIGN_FETCH_TIMEOUT_MS = 30_000

export type DocuSignJson = Record<string, unknown>

function providerError(data: DocuSignJson, fallback: string): string {
  return (
    (typeof data.message === 'string' && data.message) ||
    (typeof data.errorCode === 'string' && data.errorCode) ||
    fallback
  )
}

async function fetchDocusign(
  input: string,
  init: RequestInit = {},
  parentSignal?: AbortSignal
): Promise<Response> {
  parentSignal?.throwIfAborted()
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('DocuSign request timed out')),
    DOCUSIGN_FETCH_TIMEOUT_MS
  )
  const abort = () => controller.abort(parentSignal?.reason ?? new Error('Request aborted'))
  parentSignal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abort)
  }
}

async function readJson(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<DocuSignJson> {
  return readResponseJsonWithLimit<DocuSignJson>(response, {
    maxBytes: MAX_DOCUSIGN_JSON_BYTES,
    label,
    signal,
  })
}

export class DocuSignClient {
  private constructor(
    private readonly accessToken: string,
    private readonly apiBase: string
  ) {}

  static async create(accessToken: string, signal?: AbortSignal): Promise<DocuSignClient> {
    const response = await fetchDocusign(
      getDocusignOAuthUrl('/oauth/userinfo'),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      signal
    )
    if (!response.ok) {
      await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'DocuSign account error response',
        signal,
      }).catch(() => '')
      throw new DocuSignOperationError(
        `Failed to resolve DocuSign account: ${response.status}`,
        500
      )
    }
    const data = await readJson(response, 'DocuSign account response', signal)
    const accounts = Array.isArray(data.accounts) ? data.accounts : []
    const account =
      accounts.find(
        (candidate) => candidate && typeof candidate === 'object' && candidate.is_default === true
      ) ?? accounts[0]
    if (!account || typeof account !== 'object') {
      throw new DocuSignOperationError('No DocuSign accounts found for this user', 500)
    }
    const baseUri = typeof account.base_uri === 'string' ? account.base_uri : undefined
    const accountId = typeof account.account_id === 'string' ? account.account_id : undefined
    if (!baseUri) throw new DocuSignOperationError('DocuSign account is missing base_uri', 500)
    if (!accountId) throw new DocuSignOperationError('DocuSign account is missing account_id', 500)
    return new DocuSignClient(accessToken, `${baseUri}/restapi/v2.1/accounts/${accountId}`)
  }

  async json(
    path: string,
    init: RequestInit,
    label: string,
    fallback: string,
    signal?: AbortSignal
  ): Promise<DocuSignJson> {
    const response = await fetchDocusign(
      `${this.apiBase}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      },
      signal
    )
    const data = await readJson(response, label, signal)
    if (!response.ok) {
      const error = providerError(data, fallback)
      throw new DocuSignOperationError(error, response.status)
    }
    return data
  }

  async document(
    envelopeId: string,
    documentId: string,
    signal?: AbortSignal
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const response = await fetchDocusign(
      `${this.apiBase}/envelopes/${envelopeId}/documents/${documentId}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
      signal
    )
    if (!response.ok) {
      const details = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'DocuSign document error response',
        signal,
      }).catch(() => '')
      throw new DocuSignOperationError(
        `Failed to download document: ${response.status} ${details}`,
        response.status
      )
    }
    const contentType = response.headers.get('content-type') || 'application/pdf'
    const contentDisposition = response.headers.get('content-disposition') || ''
    const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    const fileName = match ? match[1].replace(/['"]/g, '') : `document-${documentId}.pdf`
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_DOCUSIGN_DOCUMENT_BYTES,
      label: 'DocuSign document download',
      signal,
    })
    return { buffer, contentType, fileName }
  }
}
