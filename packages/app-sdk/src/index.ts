/**
 * @sim/app-sdk — generated apps call sim.run through this API.
 * Preview (postMessage) and published (HTTPS gateway) share the same surface.
 */

export const APP_REQUEST_BODY_MAX_BYTES = 1_048_576
export const APP_RESPONSE_BODY_MAX_BYTES = 1_048_576
/**
 * Client-side sync abort budget. Server may run longer (plan-derived, up to
 * route maxDuration); this only cancels the browser wait, not billing.
 */
export const APP_SYNC_TIMEOUT_MS = 120_000

export type SimAppConfig = {
  publicId: string
  slug: string
  releaseId: string
  gatewayOrigin: string
}

export type SimRunInput = Record<string, unknown>

export type SimRunResult = {
  success: boolean
  executionId?: string
  outputs: Record<string, unknown>
  error?: string
}

export type SimClientMode = 'published' | 'preview'

export type PublishedTransport = {
  mode: 'published'
  config: SimAppConfig
  /** Short-lived abuse token from Turnstile session */
  getAbuseToken: () => string | Promise<string>
}

export type PreviewTransport = {
  mode: 'preview'
  /** Required for parent bridge auth — omit only in tests. */
  channelNonce?: string
  /** postMessage bridge — parent holds the Sim session */
  postMessage: (request: {
    type: 'sim.run'
    actionId: string
    input: SimRunInput
    requestId: string
    nonce?: string
  }) => Promise<SimRunResult>
}

export type SimClientOptions = PublishedTransport | PreviewTransport

function assertBodySize(payload: unknown): void {
  const size = new TextEncoder().encode(JSON.stringify(payload)).length
  if (size > APP_REQUEST_BODY_MAX_BYTES) {
    throw new Error(`Request body exceeds ${APP_REQUEST_BODY_MAX_BYTES} bytes`)
  }
}

async function bootstrapAbuseToken(config: SimAppConfig): Promise<string> {
  let visitorId = localStorage.getItem('sim_visitor_id')
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    localStorage.setItem('sim_visitor_id', visitorId)
  }
  const turnstileToken =
    typeof window.__SIM_TURNSTILE_TOKEN === 'string' ? window.__SIM_TURNSTILE_TOKEN : undefined
  const res = await fetch('/__sim/abuse/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicId: config.publicId,
      visitorId,
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
  })
  const json = (await res.json()) as { abuseToken?: string; error?: string }
  if (!res.ok || !json.abuseToken) {
    throw new Error(json.error || 'Abuse session failed')
  }
  sessionStorage.setItem('sim_abuse_token', json.abuseToken)
  return json.abuseToken
}

async function defaultGetAbuseToken(config: SimAppConfig, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const existing = sessionStorage.getItem('sim_abuse_token')
    if (existing) return existing
  } else {
    sessionStorage.removeItem('sim_abuse_token')
  }
  return bootstrapAbuseToken(config)
}

async function postAction(
  options: PublishedTransport,
  actionId: string,
  input: SimRunInput,
  abuseToken: string,
  signal: AbortSignal
) {
  const body = { input }
  assertBodySize(body)
  const url = `${options.config.gatewayOrigin.replace(/\/$/, '')}/__sim/actions/releases/${options.config.releaseId}/actions/${encodeURIComponent(actionId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sim-apps-abuse-token': abuseToken,
    },
    body: JSON.stringify(body),
    signal,
  })
  const json = (await res.json()) as {
    data?: SimRunResult
    error?: string
    code?: string
    success?: boolean
    executionId?: string
    outputs?: Record<string, unknown>
  }
  return { res, json }
}

async function publishedRun(
  options: PublishedTransport,
  actionId: string,
  input: SimRunInput
): Promise<SimRunResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APP_SYNC_TIMEOUT_MS)
  try {
    let abuseToken = await options.getAbuseToken()
    let { res, json } = await postAction(options, actionId, input, abuseToken, controller.signal)

    // Refresh expired session tokens once, then retry.
    if (!res.ok && (json.code === 'ABUSE_TOKEN_REQUIRED' || res.status === 403)) {
      sessionStorage.removeItem('sim_abuse_token')
      abuseToken = await defaultGetAbuseToken(options.config, true)
      ;({ res, json } = await postAction(options, actionId, input, abuseToken, controller.signal))
    }

    if (!res.ok) {
      return { success: false, outputs: {}, error: json.error || 'Request failed' }
    }
    if (json.data) return json.data
    return {
      success: true,
      executionId: json.executionId,
      outputs: json.outputs || {},
    }
  } finally {
    clearTimeout(timer)
  }
}

export function createSimClient(options: SimClientOptions) {
  return {
    async run(actionId: string, input: SimRunInput = {}): Promise<SimRunResult> {
      if (options.mode === 'preview') {
        assertBodySize({ actionId, input })
        const requestId = crypto.randomUUID()
        return options.postMessage({
          type: 'sim.run',
          actionId,
          input,
          requestId,
          nonce: options.channelNonce,
        })
      }
      return publishedRun(options, actionId, input)
    },
  }
}

/**
 * Prefer this in templates: published mode with abuse-token bootstrap from window config.
 * Preview mode is selected when `window.__SIM_PREVIEW__` is set by the preview shell.
 */
export function createSimClientFromWindow(options?: {
  getAbuseToken?: () => string | Promise<string>
  channelNonce?: string
  parentOrigin?: string
}): ReturnType<typeof createSimClient> {
  const preview = window.__SIM_PREVIEW__
  if (preview) {
    const channelNonce = options?.channelNonce || preview.channelNonce
    const parentOrigin = options?.parentOrigin || preview.parentOrigin
    return createSimClient({
      mode: 'preview',
      channelNonce,
      postMessage: ({ type, actionId, input, requestId, nonce }) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            window.removeEventListener('message', onMessage)
            resolve({
              success: false,
              outputs: {},
              error: `Preview run timed out after ${APP_SYNC_TIMEOUT_MS}ms`,
            })
          }, APP_SYNC_TIMEOUT_MS)
          const onMessage = (event: MessageEvent) => {
            if (event.origin !== parentOrigin) return
            if (event.source !== parent) return
            const data = event.data as {
              type?: string
              requestId?: string
              nonce?: string
              result?: SimRunResult
            }
            if (
              data?.type !== 'sim.run.result' ||
              data.requestId !== requestId ||
              data.nonce !== channelNonce
            ) {
              return
            }
            clearTimeout(timer)
            window.removeEventListener('message', onMessage)
            resolve(data.result || { success: false, outputs: {}, error: 'Empty preview result' })
          }
          window.addEventListener('message', onMessage)
          parent.postMessage(
            { type, actionId, input, requestId, nonce: nonce || channelNonce },
            parentOrigin
          )
        }),
    })
  }

  const config = window.__SIM_APP_CONFIG
  if (!config) throw new Error('Missing __SIM_APP_CONFIG')
  return createSimClient({
    mode: 'published',
    config,
    getAbuseToken: options?.getAbuseToken || (() => defaultGetAbuseToken(config)),
  })
}

export type SimClient = ReturnType<typeof createSimClient>

declare global {
  interface Window {
    __SIM_APP_CONFIG?: SimAppConfig
    __SIM_TURNSTILE_TOKEN?: string
    __SIM_PREVIEW__?: { channelNonce: string; parentOrigin: string }
  }
}
