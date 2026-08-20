import { truncate } from '@sim/utils/string'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { ModalApiModel, ModalModelSummary, ModalProxyTokenParams } from '@/tools/modal/types'

/**
 * Shared Endpoints are reachable through this host and routed on the OpenAI
 * `model` field, so the model ID is the endpoint's own hostname.
 */
export const MODAL_SHARED_INFERENCE_URL = 'https://inference.us-west.modal.direct'

export const MAX_MODAL_RESPONSE_BODY_BYTES = 10 * 1024 * 1024

const MAX_MODAL_ERROR_BODY_BYTES = 64 * 1024

/**
 * Builds the proxy-token headers Modal's request proxy authenticates against.
 *
 * Uses the `Modal-Key`/`Modal-Secret` pair rather than the equivalent combined
 * `Authorization: Bearer wk-<id>.ws-<secret>` form, so a web function that
 * validates its own bearer token keeps the `Authorization` header free.
 */
export function modalProxyAuthHeaders(
  params: ModalProxyTokenParams,
  options: { required?: boolean } = {}
): Record<string, string> {
  const tokenId = params.tokenId?.trim()
  const tokenSecret = params.tokenSecret?.trim()

  if (!tokenId || !tokenSecret) {
    if (options.required) {
      throw new Error(
        'Modal token ID and token secret are required. Create a proxy token with `modal workspace proxy-tokens create`.'
      )
    }
    return {}
  }

  return { 'Modal-Key': tokenId, 'Modal-Secret': tokenSecret }
}

/**
 * Validates an absolute Modal URL and strips its trailing slashes. Modal
 * terminates TLS for `.modal.run`, `.modal.direct`, and custom domains alike,
 * so a cleartext URL is always a misconfiguration that would leak the token.
 */
function parseModalUrl(rawUrl: string | undefined, label: string): URL {
  const trimmed = rawUrl?.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      `${label} must be an absolute URL (e.g. https://your-workspace--your-app-your-function.modal.run)`
    )
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https`)
  }

  return parsed
}

/** Resolves the URL of a deployed Modal Web Function or Server. */
export function modalWebFunctionUrl(rawUrl: string): string {
  return parseModalUrl(rawUrl, 'Modal function URL').toString().replace(/\/+$/, '')
}

/**
 * Resolves an OpenAI-compatible path on a Modal Endpoint. Accepts the endpoint
 * root or a URL that already ends in `/v1`, so a value copied from the
 * dashboard and one copied from `modal endpoint list` resolve identically.
 */
export function modalOpenAiUrl(rawUrl: string | undefined, path: string): string {
  const parsed = parseModalUrl(rawUrl, 'Modal endpoint URL')
  const base = parsed.toString().replace(/\/+$/, '')
  const root = base.endsWith('/v1') ? base : `${base}/v1`
  return `${root}${path}`
}

/**
 * Appends query parameters to a URL, skipping empty keys so a blank table row
 * cannot introduce a stray `?=` into the request.
 */
export function appendModalQueryParams(url: string, queryParams: Record<string, unknown>): string {
  const entries = Object.entries(queryParams).filter(
    ([key, value]) => key.trim() !== '' && value !== undefined && value !== null
  )
  if (entries.length === 0) return url

  const separator = url.includes('?') ? '&' : '?'
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${url}${separator}${query}`
}

/**
 * Extracts a readable message from a Modal proxy or endpoint error response.
 * The proxy returns `{ "error": "..." }`; the OpenAI-compatible inference
 * servers behind an Endpoint return `{ "error": { "message": "..." } }`.
 */
export async function extractModalError(response: Response, fallback: string): Promise<string> {
  const prefix = `${fallback} (status ${response.status})`

  let text: string
  try {
    text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_MODAL_ERROR_BODY_BYTES,
      label: 'Modal error response body',
      allowNoBodyFallback: true,
    })
  } catch {
    return prefix
  }

  if (!text.trim()) return prefix

  try {
    const data = JSON.parse(text)
    if (typeof data?.error === 'string') return `${prefix}: ${data.error}`
    if (typeof data?.error?.message === 'string') return `${prefix}: ${data.error.message}`
    if (typeof data?.detail === 'string') return `${prefix}: ${data.detail}`
    if (typeof data?.message === 'string') return `${prefix}: ${data.message}`
  } catch {
    return `${prefix}: ${truncate(text.trim(), 500)}`
  }

  return `${prefix}: ${truncate(text.trim(), 500)}`
}

/**
 * Coerces an optional user- or LLM-provided value to a number, treating
 * empty/missing values as undefined.
 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  return Number.isNaN(num) ? undefined : num
}

/** Maps a raw OpenAI-compatible model entry to the normalized summary shape. */
export function mapModalModel(model: ModalApiModel | null | undefined): ModalModelSummary {
  return {
    id: model?.id ?? '',
    object: model?.object ?? null,
    created: model?.created ?? null,
    ownedBy: model?.owned_by ?? null,
  }
}

export const MODAL_MODEL_OUTPUT_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Model ID. For a Shared Endpoint this is the endpoint hostname',
  },
  object: { type: 'string', description: 'Object type reported by the endpoint', optional: true },
  created: { type: 'number', description: 'Creation timestamp in epoch seconds', optional: true },
  ownedBy: { type: 'string', description: 'Owner reported by the endpoint', optional: true },
} as const
