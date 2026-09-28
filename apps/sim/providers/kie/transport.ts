import { isRecordLike } from '@sim/utils/object'

/**
 * Kie codes with no matching HTTP meaning, mapped so the SDKs' retry policy treats
 * them correctly: 455 (service unavailable) and 501 (generation failed) are transient,
 * 505 (feature disabled) is not.
 */
const KIE_CODE_TO_HTTP_STATUS: Record<number, number> = {
  455: 503,
  501: 502,
  505: 403,
}

function toHttpStatus(code: number): number {
  const mapped = KIE_CODE_TO_HTTP_STATUS[code]
  if (mapped) return mapped
  return code >= 400 && code <= 599 ? code : 502
}

/**
 * Wraps `fetch` so Kie responses read like the APIs they proxy.
 *
 * Most Kie chat routes answer failures (bad key, no credits, rate limit) with
 * HTTP 200 and a `{ code, msg }` body. The Anthropic SDK and the Responses core
 * would read that as a successful, empty completion, so this rewrites it into a
 * real error response carrying Kie's code and message. Kie also sends some JSON
 * bodies with no content type, which the Anthropic SDK would parse as text; those
 * are labeled as JSON. Streams are never buffered: they are typed
 * `text/event-stream`, and a failed streaming request comes back as JSON.
 */
export function createKieFetch(baseFetch?: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await (baseFetch ?? fetch)(input, init)
    const contentType = response.headers.get('content-type')?.toLowerCase()
    if (response.status !== 200 || (contentType && !contentType.includes('application/json'))) {
      return response
    }

    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }

    const headers = rebodiedHeaders(response.headers)
    if (body !== undefined && !contentType) headers.set('content-type', 'application/json')
    if (!isRecordLike(body) || typeof body.code !== 'number' || body.code === 200) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    const message = typeof body.msg === 'string' ? body.msg : `Kie request failed (${body.code})`
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify({ type: 'error', error: { type: 'kie_error', message } }), {
      status: toHttpStatus(body.code),
      headers,
    })
  }
}

/**
 * Upstream headers for a body that has already been read and decoded. `Retry-After`
 * and request ids must survive for the retry policy and diagnostics; the length and
 * encoding no longer describe the new body.
 */
function rebodiedHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return headers
}
