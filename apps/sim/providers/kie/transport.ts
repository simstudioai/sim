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
 * Wraps `fetch` so Kie errors surface as HTTP errors.
 *
 * Most Kie chat routes answer failures (bad key, no credits, rate limit) with
 * HTTP 200 and a `{ code, msg }` body. The Anthropic SDK and the Responses core
 * would read that as a successful, empty completion, so this rewrites it into a
 * real error response carrying Kie's code and message. Streams are never
 * buffered: a failed streaming request comes back as JSON, not `text/event-stream`.
 */
export function createKieFetch(baseFetch?: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await (baseFetch ?? fetch)(input, init)
    const contentType = response.headers.get('content-type') ?? ''
    if (response.status !== 200 || !contentType.includes('application/json')) return response

    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }

    if (!isRecordLike(body) || typeof body.code !== 'number' || body.code === 200) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const message = typeof body.msg === 'string' ? body.msg : `Kie request failed (${body.code})`
    return new Response(JSON.stringify({ type: 'error', error: { type: 'kie_error', message } }), {
      status: toHttpStatus(body.code),
      headers: { 'content-type': 'application/json' },
    })
  }
}
