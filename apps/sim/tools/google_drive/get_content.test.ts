/**
 * @vitest-environment node
 *
 * `google_drive_get_content` performs its content fetch inside
 * `transformResponse`, using global `fetch` — outside the shared tool
 * transport, so the executor's response-body bound never applies to it. Both
 * branches then called `response.text()` with no `content-length` pre-check
 * and no cap, so an arbitrarily large Drive file was materialized twice (raw
 * bytes plus the decoded string) and returned whole as a workflow variable.
 *
 * The cap is `MAX_EXPORT_BYTES`, the Drive integration's existing 10 MB
 * content ceiling, applied to both the export and the `alt=media` branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { getContentTool } from '@/tools/google_drive/get_content'
import { MAX_EXPORT_BYTES } from '@/tools/google_drive/utils'

const mockFetch = vi.fn()

const DOC_MIME = 'application/vnd.google-apps.document'

function metadataResponse(mimeType: string) {
  return {
    ok: true,
    status: 200,
    statusText: '',
    json: async () => ({
      id: 'file-abc',
      name: 'notes',
      mimeType,
      capabilities: { canReadRevisions: false },
    }),
  } as unknown as Response
}

/** A response that only *declares* an oversized body, so nothing is buffered. */
function oversizedDeclaredResponse(): Response {
  return new Response('x', {
    status: 200,
    headers: { 'content-length': String(MAX_EXPORT_BYTES + 1) },
  })
}

/** A chunked response with no content-length, so only the stream count catches it. */
function oversizedStreamedResponse(): Response {
  const chunk = new Uint8Array(1024 * 1024)
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > MAX_EXPORT_BYTES) {
        controller.close()
        return
      }
      sent += chunk.byteLength
      controller.enqueue(chunk)
    },
  })
  return new Response(stream, { status: 200 })
}

/** Resolves to the rejection value, so a failure prints a boolean, not 10 MB. */
async function rejectionOf(mimeType: string): Promise<unknown> {
  return run(mimeType).then(
    () => new Error('expected the content read to be rejected'),
    (error) => error
  )
}

async function run(mimeType: string) {
  return getContentTool.transformResponse!(metadataResponse(mimeType), {
    accessToken: 'token-123',
    fileId: 'file-abc',
    includeRevisions: false,
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

describe('google_drive_get_content content cap', () => {
  it('rejects an export whose declared size exceeds the cap', async () => {
    mockFetch.mockResolvedValueOnce(oversizedDeclaredResponse())

    expect(isPayloadSizeLimitError(await rejectionOf(DOC_MIME))).toBe(true)
  })

  it('rejects a download whose declared size exceeds the cap', async () => {
    mockFetch.mockResolvedValueOnce(oversizedDeclaredResponse())

    expect(isPayloadSizeLimitError(await rejectionOf('application/pdf'))).toBe(true)
  })

  it('aborts a streamed download that grows past the cap with no content-length', async () => {
    mockFetch.mockResolvedValueOnce(oversizedStreamedResponse())

    expect(isPayloadSizeLimitError(await rejectionOf('application/pdf'))).toBe(true)
  })

  it('returns content under the cap unchanged', async () => {
    mockFetch.mockResolvedValueOnce(new Response('hello drive', { status: 200 }))

    const result = (await run('application/pdf')) as {
      success: boolean
      output: { content: string }
    }
    expect(result.success).toBe(true)
    expect(result.output.content).toBe('hello drive')
  })
})
